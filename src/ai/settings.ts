export interface Settings {
  apiKey: string;
  model: string;
  /** "auto": use Claude if available, else offline. "offline": never leave the browser. */
  mode: "auto" | "offline";
}
const KEY = "lumen:settings";
export const DEFAULT_MODEL = "claude-sonnet-5-5";

export function loadSettings(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "{}");
    return { apiKey: raw.apiKey || "", model: raw.model || DEFAULT_MODEL, mode: raw.mode === "offline" ? "offline" : "auto" };
  } catch {
    return { apiKey: "", model: DEFAULT_MODEL, mode: "auto" };
  }
}
export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* private mode etc. */
  }
}
