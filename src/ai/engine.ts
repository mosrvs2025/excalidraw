import { askClaude, probeServer, type ClaudeRequest } from "./claude";
import { planOffline } from "./local";
import type { IntentId } from "./intents";
import type { Plan } from "./schema";
import type { Settings } from "./settings";

let serverEnabled: boolean | null = null;
export async function serverHasClaude() {
  if (serverEnabled === null) serverEnabled = await probeServer();
  return serverEnabled;
}

export type EngineKind = "claude" | "offline";

export async function engineAvailable(s: Settings): Promise<EngineKind> {
  if (s.mode === "offline") return "offline";
  if (s.apiKey) return "claude";
  return (await serverHasClaude()) ? "claude" : "offline";
}

export interface RunInput extends ClaudeRequest {
  intent?: IntentId;
}

/** Run an intent. Claude when available — and if it fails for any reason, the offline engine still delivers. */
export async function runIntent(input: RunInput, s: Settings, signal?: AbortSignal): Promise<Plan & { note?: string }> {
  const kind = await engineAvailable(s);
  if (kind === "claude") {
    try {
      return await askClaude(input, s, await serverHasClaude(), signal);
    } catch (e: any) {
      if (e?.name === "AbortError") throw e;
      const plan = planOffline(input);
      return { ...plan, note: `Claude unavailable (${String(e?.message ?? e).slice(0, 80)}) — used the offline engine.` };
    }
  }
  return planOffline(input);
}
