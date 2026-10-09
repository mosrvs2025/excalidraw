/**
 * Provider adapters. Every provider gets the same system prompt, canvas context, selection image and
 * `canvas_plan` tool; each adapter only translates the wire format and extracts the plan.
 */
import { askClaude, buildUserText, systemPrompt, TOOL, type ClaudeRequest } from "./claude";
import { sanitizePlan, type Plan } from "./schema";
import { PROVIDERS, type Settings } from "./settings";

const planOf = (raw: unknown, label: string): Plan => {
  const plan = sanitizePlan(raw);
  if (!plan.ops.length && !plan.say.trim()) throw new Error(`${label} returned an empty plan`);
  plan.engine = "claude";
  return plan;
};

/** Models without tool support sometimes answer with JSON in plain text. */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("No plan found in the response");
  return JSON.parse(body.slice(start, end + 1));
}

/* ───────── OpenAI & OpenAI-compatible ───────── */

export function buildOpenAI(req: ClaudeRequest, model: string, forceTool: boolean) {
  const user: any[] = [{ type: "text", text: buildUserText(req) }];
  if (req.imageBase64) user.push({ type: "image_url", image_url: { url: `data:image/png;base64,${req.imageBase64}` } });
  return {
    model,
    messages: [
      { role: "system", content: systemPrompt() },
      { role: "user", content: user },
    ],
    tools: [{ type: "function", function: { name: TOOL.name, description: TOOL.description, parameters: TOOL.input_schema } }],
    ...(forceTool ? { tool_choice: { type: "function", function: { name: TOOL.name } } } : {}),
  };
}

export function parseOpenAI(json: any): Plan {
  const msg = json?.choices?.[0]?.message;
  const call = msg?.tool_calls?.find((c: any) => c?.function?.name === TOOL.name) ?? msg?.tool_calls?.[0];
  if (call?.function?.arguments) {
    const args = typeof call.function.arguments === "string" ? JSON.parse(call.function.arguments) : call.function.arguments;
    return planOf(args, "The model");
  }
  if (typeof msg?.content === "string" && msg.content.trim()) return planOf(extractJson(msg.content), "The model");
  throw new Error(json?.error?.message || "The model returned no plan");
}

/* ───────── Gemini ───────── */

export function buildGemini(req: ClaudeRequest) {
  const parts: any[] = [{ text: buildUserText(req) }];
  if (req.imageBase64) parts.push({ inlineData: { mimeType: "image/png", data: req.imageBase64 } });
  return {
    systemInstruction: { parts: [{ text: systemPrompt() }] },
    contents: [{ role: "user", parts }],
    tools: [{ functionDeclarations: [{ name: TOOL.name, description: TOOL.description, parameters: TOOL.input_schema }] }],
    toolConfig: { functionCallingConfig: { mode: "ANY", allowedFunctionNames: [TOOL.name] } },
  };
}

export function parseGemini(json: any): Plan {
  const parts: any[] = json?.candidates?.[0]?.content?.parts ?? [];
  const call = parts.find((p) => p.functionCall)?.functionCall;
  if (call?.args) return planOf(call.args, "Gemini");
  const text = parts.map((p) => p.text).filter(Boolean).join("");
  if (text) return planOf(extractJson(text), "Gemini");
  throw new Error(json?.error?.message || json?.promptFeedback?.blockReason || "Gemini returned no plan");
}

/* ───────── dispatch ───────── */

const errMsg = (json: any, status: number, who: string) =>
  json?.error?.message || (typeof json?.error === "string" ? json.error : "") || `${who} request failed (${status})`;

export async function askProvider(req: ClaudeRequest, s: Settings, hostedOk: boolean, signal?: AbortSignal): Promise<Plan> {
  // no personal key: fall back to the deployment's hosted engine
  if (!s.apiKey && s.provider !== "custom") return askClaude(req, { ...s, model: PROVIDERS.anthropic.model }, hostedOk, signal);
  switch (s.provider) {
    case "openai":
    case "custom": {
      const base = s.provider === "openai" ? "https://api.openai.com/v1" : s.baseUrl.replace(/\/+$/, "");
      if (!base) throw new Error("Add the endpoint URL in settings");
      const model = s.model || PROVIDERS[s.provider].model;
      if (!model) throw new Error("Add a model name in settings");
      const res = await fetch(`${base}/chat/completions`, {
        method: "POST",
        signal,
        headers: { "content-type": "application/json", ...(s.apiKey ? { authorization: `Bearer ${s.apiKey}` } : {}) },
        body: JSON.stringify(buildOpenAI(req, model, s.provider === "openai")),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(errMsg(json, res.status, "OpenAI-compatible"));
      return parseOpenAI(json);
    }
    case "gemini": {
      const model = s.model || PROVIDERS.gemini.model;
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        signal,
        headers: { "content-type": "application/json", "x-goog-api-key": s.apiKey },
        body: JSON.stringify(buildGemini(req)),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(errMsg(json, res.status, "Gemini"));
      return parseGemini(json);
    }
    default:
      return askClaude(req, { ...s, model: s.model || PROVIDERS.anthropic.model }, hostedOk, signal);
  }
}
