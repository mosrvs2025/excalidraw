/**
 * Collaboration architecture.
 *
 * The app talks to a SyncAdapter, never to a transport. Today's adapter is BroadcastChannel:
 * real-time, conflict-free (Excalidraw's reconcileElements) sync between tabs/windows of the same browser,
 * with presence and live cursors. A WebSocket / Yjs / Liveblocks adapter can implement the same
 * interface for cross-device rooms without touching the canvas, store, or AI code.
 */
export type SyncMessage =
  | { t: "hello"; from: string; name: string; color: string }
  | { t: "scene"; from: string; elements: any[] }
  | { t: "pointer"; from: string; x: number; y: number; tool: string; name: string; color: string }
  | { t: "leave"; from: string };

export interface SyncAdapter {
  readonly id: string;
  start(onMessage: (m: SyncMessage) => void): void;
  publish(m: SyncMessage): void;
  stop(): void;
}

export class BroadcastSync implements SyncAdapter {
  readonly id = Math.random().toString(36).slice(2, 10);
  private ch: BroadcastChannel | null = null;
  constructor(private room: string) {}
  start(onMessage: (m: SyncMessage) => void) {
    if (typeof BroadcastChannel === "undefined") return;
    this.ch = new BroadcastChannel(`lumen:${this.room}`);
    this.ch.onmessage = (e) => {
      const m = e.data as SyncMessage;
      if (m && m.from !== this.id) onMessage(m);
    };
  }
  publish(m: SyncMessage) {
    this.ch?.postMessage(m);
  }
  stop() {
    this.publish({ t: "leave", from: this.id });
    this.ch?.close();
    this.ch = null;
  }
}

const NAMES = ["Fox", "Owl", "Otter", "Heron", "Lynx", "Finch", "Panda", "Wren", "Koi", "Moth"];
const COLORS = ["#e8590c", "#1c7ed6", "#2f9e44", "#d6336c", "#7048e8", "#e19b00", "#0c8599"];
export const randomIdentity = () => ({
  name: NAMES[Math.floor(Math.random() * NAMES.length)],
  color: COLORS[Math.floor(Math.random() * COLORS.length)],
});

/**
 * Cross-device adapter: same message protocol as BroadcastSync, carried over a WebSocket relay
 * (server/relay.mjs). Conflict resolution stays client-side (reconcileElements), so the relay is stateless.
 */
export class WebSocketSync implements SyncAdapter {
  readonly id = Math.random().toString(36).slice(2, 10);
  private ws: WebSocket | null = null;
  private closed = false;
  private queue: string[] = [];
  private onMessage: (m: SyncMessage) => void = () => {};
  constructor(
    private url: string,
    private room: string,
    private onStatus: (s: "connecting" | "open" | "closed") => void = () => {},
  ) {}
  start(onMessage: (m: SyncMessage) => void) {
    this.onMessage = onMessage;
    this.connect();
  }
  private connect() {
    if (this.closed) return;
    this.onStatus("connecting");
    const ws = new WebSocket(`${this.url.replace(/\/+$/, "")}/room/${encodeURIComponent(this.room)}`);
    this.ws = ws;
    ws.onopen = () => {
      this.onStatus("open");
      this.queue.splice(0).forEach((q) => ws.send(q));
    };
    ws.onmessage = (e) => {
      try {
        const m = JSON.parse(String(e.data)) as SyncMessage;
        if (m && m.from !== this.id) this.onMessage(m);
      } catch {}
    };
    ws.onclose = () => {
      this.onStatus("closed");
      if (!this.closed) setTimeout(() => this.connect(), 1500);
    };
    ws.onerror = () => ws.close();
  }
  publish(m: SyncMessage) {
    const data = JSON.stringify(m);
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(data);
    else if (m.t === "scene" || m.t === "hello") this.queue = [...this.queue.slice(-20), data]; // pointers aren't worth queueing
  }
  stop() {
    this.publish({ t: "leave", from: this.id });
    this.closed = true;
    this.ws?.close();
  }
}

export const newRoomId = () => {
  const a = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(a, (b) => "abcdefghijklmnopqrstuvwxyz234567"[b & 31]).join("");
};
const ROOMS = "lumen:rooms";
const readRooms = (): Record<string, string> => {
  try {
    return JSON.parse(localStorage.getItem(ROOMS) || "{}");
  } catch {
    return {};
  }
};
export const roomOf = (projectId: string) => readRooms()[projectId] || null;
export const projectOfRoom = (room: string) => Object.entries(readRooms()).find(([, r]) => r === room)?.[0] ?? null;
export const setRoom = (projectId: string, room: string | null) => {
  const m = readRooms();
  if (room) m[projectId] = room;
  else delete m[projectId];
  try {
    localStorage.setItem(ROOMS, JSON.stringify(m));
  } catch {}
};
