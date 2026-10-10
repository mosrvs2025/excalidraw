/** One catalogue for the cheat sheet, the chips' key hints and the tests. `mod` is ⌘ on Apple platforms, Ctrl elsewhere. */
export const isApple = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const MOD = () => (isApple() ? "⌘" : "Ctrl");
export const ALT = () => (isApple() ? "⌥" : "Alt");

export interface Shortcut {
  keys: string[]; // display keys, in order; "mod"/"alt" are replaced per platform
  does: string;
  /** the raw key used by the app (for conflict tests); native shortcuts belong to Excalidraw */
  native?: boolean;
}
export interface ShortcutGroup {
  title: string;
  items: Shortcut[];
}

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: "Ask & command",
    items: [
      { keys: ["/"], does: "Ask the canvas — type / for commands" },
      { keys: ["mod", "K"], does: "Command palette (search everything)" },
      { keys: ["↵"], does: "Run what you typed" },
      { keys: ["mod", "↵"], does: "Add what you typed as a note" },
      { keys: ["alt", "1…9"], does: "Run the Nth suggestion above the box" },
      { keys: ["?"], does: "This cheat sheet" },
    ],
  },
  {
    title: "Create",
    items: [
      { keys: ["N"], does: "Rapid sticky notes: type, ↵ for the next, Esc to stop" },
      { keys: ["W"], does: "Turn the selection into a world (or make an empty one)" },
      { keys: ["/note", "…"], does: "Add a note — /text, /h1, /list, /todo, /slide, /link, /date" },
    ],
  },
  {
    title: "Move through worlds & slides",
    items: [
      { keys: ["alt", "↓"], does: "Enter the selected world" },
      { keys: ["alt", "↑"], does: "Go up a level" },
      { keys: ["alt", "P"], does: "Present (← → Space Esc)" },
      { keys: ["alt", "T"], does: "Templates" },
      { keys: ["alt", "H"], does: "Version history" },
    ],
  },
  {
    title: "Canvas (built in)",
    items: [
      { keys: ["V"], does: "Select", native: true },
      { keys: ["R"], does: "Rectangle", native: true },
      { keys: ["D"], does: "Diamond", native: true },
      { keys: ["O"], does: "Ellipse", native: true },
      { keys: ["A"], does: "Arrow", native: true },
      { keys: ["L"], does: "Line", native: true },
      { keys: ["P"], does: "Pen", native: true },
      { keys: ["T"], does: "Text", native: true },
      { keys: ["F"], does: "Frame (a slide)", native: true },
      { keys: ["E"], does: "Eraser", native: true },
      { keys: ["H"], does: "Hand (pan)", native: true },
      { keys: ["mod", "Z"], does: "Undo  (⇧ to redo)", native: true },
      { keys: ["mod", "D"], does: "Duplicate", native: true },
      { keys: ["mod", "G"], does: "Group", native: true },
      { keys: ["⇧", "1"], does: "Zoom to fit everything", native: true },
    ],
  },
];

/** Single plain keys Lumen claims (no modifiers). Must never collide with Excalidraw's own tool keys. */
export const LUMEN_SINGLE_KEYS = ["n", "w", "?", "/"];
export const EXCALIDRAW_SINGLE_KEYS = ["v", "r", "d", "o", "a", "l", "p", "t", "e", "h", "f", "k", "i", "q", "g", "s", "x", "z", "y", "c", "m", "b", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];

export const display = (k: string) => (k === "mod" ? MOD() : k === "alt" ? ALT() : k);
