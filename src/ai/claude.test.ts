import { describe, expect, it } from "vitest";
import { handleAi, rateLimited } from "../../api/_core";
import { buildPayload, parseResponse } from "./claude";
import type { CanvasGraph } from "../canvas/context";

const g: CanvasGraph = { scope: "canvas", items: [], edges: [], aliasToId: {}, idToAlias: {}, bounds: null };

describe("claude client", () => {
  it("forces the plan tool and includes the canvas + request", () => {
    const p = buildPayload({ prompt: "do it", graph: g });
    expect(p.tool_choice).toEqual({ type: "tool", name: "canvas_plan" });
    expect(JSON.stringify(p.messages)).toContain("Request: do it");
  });
  it("parses and sanitises tool output", () => {
    const plan = parseResponse({ content: [{ type: "tool_use", name: "canvas_plan", input: { say: "ok", ops: [{ op: "notes", items: [{ text: "hi" }] }, { op: "bad" }] } }] });
    expect(plan.engine).toBe("claude");
    expect(plan.ops).toHaveLength(1);
  });
  it("throws a useful error when no plan comes back", () => {
    expect(() => parseResponse({ error: { message: "overloaded" } })).toThrow(/overloaded/);
  });
});

describe("server proxy", () => {
  const env = { ANTHROPIC_API_KEY: "k", LUMEN_MODEL: "m" };
  it("reports enabled state without leaking the key", async () => {
    const r = await handleAi({ method: "GET", body: undefined, ip: "1", env });
    expect(r.json).toEqual({ enabled: true });
    expect((await handleAi({ method: "GET", body: undefined, ip: "1", env: {} })).json).toEqual({ enabled: false });
  });
  it("forwards only whitelisted fields with the server's model + key", async () => {
    let seen: any;
    const f = (async (url: string, init: any) => {
      seen = { url, init, body: JSON.parse(init.body) };
      return { status: 200, ok: true, json: async () => ({ ok: 1 }) };
    }) as any;
    const r = await handleAi({ method: "POST", ip: "2", env, body: { model: "evil", max_tokens: 999999, messages: [], tools: [], extra: 1 } }, f);
    expect(r.status).toBe(200);
    expect(seen.body.model).toBe("m");
    expect(seen.body.max_tokens).toBe(12000);
    expect(seen.body.extra).toBeUndefined();
    expect(seen.init.headers["x-api-key"]).toBe("k");
  });
  it("rejects bad bodies, missing key, and floods", async () => {
    expect((await handleAi({ method: "POST", ip: "3", env, body: {} })).status).toBe(400);
    expect((await handleAi({ method: "POST", ip: "3", env: {}, body: {} })).status).toBe(503);
    let limited = false;
    for (let i = 0; i < 25; i++) limited ||= rateLimited("flood");
    expect(limited).toBe(true);
  });
});
