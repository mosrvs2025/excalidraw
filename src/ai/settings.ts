export type ProviderId = "anthropic" | "openai" | "gemini" | "custom";

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  short: string;
  model: string;
  keyHint: string;
  keyUrl?: string;
}

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  anthropic: { id: "anthropic", label: "Anthropic Claude", short: "Claude", model: "claude-sonnet-5-5", keyHint: "sk-ant-…", keyUrl: "https://console.anthropic.com/settings/keys" },
  openai: { id: "openai", label: "OpenAI", short: "GPT", model: "gpt-4o", keyHint: "sk-…", keyUrl: "https://platform.openai.com/api-keys" },
  gemini: { id: "gemini", label: "Google Gemini", short: "Gemini", model: "gemini-2.5-flash", keyHint: "AIza…", keyUrl: "https://aistudio.google.com/apikey" },
  custom: { id: "custom", label: "Other (OpenAI-compatible)", short: "Custom", model: "", keyHint: "key (optional for local)" },
};

export interface Settings {
  provider: ProviderId;
  apiKey: string;
  model: string;
  /** only for provider "custom": e.g. https://openrouter.ai/api/v1 or http://localhost:11434/v1 */
  baseUrl: string;
  /** "auto": use AI if available, else offline. "offline": never leave the browser. */
  mode: "auto" | "offline";
}

const KEY = "lumen:settings";
const ONBOARDED = "lumen:onboarded";
export const DEFAULT_MODEL = PROVIDERS.anthropic.model;

export function loadSettings(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "{}");
    const provider: ProviderId = raw.provider in PROVIDERS ? raw.provider : "anthropic"; // older saves were Anthropic-only
    return {
      provider,
      apiKey: raw.apiKey || "",
      model: raw.model || PROVIDERS[provider].model,
      baseUrl: raw.baseUrl || "",
      mode: raw.mode === "offline" ? "offline" : "auto",
    };
  } catch {
    return { provider: "anthropic", apiKey: "", model: DEFAULT_MODEL, baseUrl: "", mode: "auto" };
  }
}
export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* private mode etc. */
  }
}
export const wasOnboarded = () => {
  try {
    return localStorage.getItem(ONBOARDED) === "1";
  } catch {
    return true;
  }
};
export const markOnboarded = () => {
  try {
    localStorage.setItem(ONBOARDED, "1");
  } catch {}
};
