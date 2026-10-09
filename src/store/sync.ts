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
