/**
 * Server-side Claude proxy core, shared by the Vercel function (api/ai.ts) and the Vite dev server.
 * The API key never reaches the browser. Requests are constrained: fixed model, capped tokens,
 * only the fields the canvas needs, a body-size limit and a small per-IP rate limit.
 */
export interface CoreRequest {
  method: string;
  body: any;
  ip: string;
  env: Record<string, string | undefined>;
}
export interface CoreResponse {
  status: number;
  json: unknown;
}

const hits = new Map<string, number[]>();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 20;

export function rateLimited(ip: string, now = Date.now()) {
  const arr = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  arr.push(now);
  hits.set(ip, arr);
  return arr.length > MAX_PER_WINDOW;
}

export async function handleAi(req: CoreRequest, fetchImpl: typeof fetch = fetch): Promise<CoreResponse> {
  const key = req.env.ANTHROPIC_API_KEY;
  if (req.method === "GET") return { status: 200, json: { enabled: Boolean(key) } };
  if (req.method !== "POST") return { status: 405, json: { error: "method not allowed" } };
  if (!key) return { status: 503, json: { error: "Claude is not configured on this server" } };
  if (rateLimited(req.ip)) return { status: 429, json: { error: "Slow down a little — too many requests." } };

  const b = req.body;
  if (!b || typeof b !== "object" || !Array.isArray(b.messages) || !Array.isArray(b.tools))
    return { status: 400, json: { error: "bad request" } };
  if (JSON.stringify(b).length > 3_500_000) return { status: 413, json: { error: "canvas context too large" } };

  const payload = {
    model: req.env.LUMEN_MODEL || "claude-sonnet-5-5",
    max_tokens: Math.min(Number(b.max_tokens) || 8000, 12000),
    system: typeof b.system === "string" ? b.system : undefined,
    messages: b.messages,
    tools: b.tools,
    tool_choice: b.tool_choice,
  };
  try {
    const r = await fetchImpl("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(payload),
    });
    const json = await r.json();
    return { status: r.status, json };
  } catch (e) {
    return { status: 502, json: { error: "upstream failure" } };
  }
}
