// Minimal room relay for Lumen live collaboration. Stateless: it forwards each message to the other
// peers in the same room. Boards stay in the participants' browsers; rooms are unguessable URLs.
//   node server/relay.mjs            (PORT=8787 by default)
// Deploy anywhere that runs Node + WebSockets (Render, Fly.io, Railway, a VPS). Not Vercel functions.
import { createServer } from "node:http";
import { WebSocketServer } from "ws";

const PORT = Number(process.env.PORT || 8787);
const MAX_PEERS = 50;
const MAX_BYTES = 8 * 1024 * 1024;
const rooms = new Map();

export function startRelay(port = PORT) {
  const http = createServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
  });
  const wss = new WebSocketServer({ server: http, maxPayload: MAX_BYTES });
  wss.on("connection", (ws, req) => {
    const m = /^\/room\/([A-Za-z0-9_-]{8,64})$/.exec(new URL(req.url, "http://x").pathname);
    if (!m) return ws.close(1008, "bad room");
    const room = rooms.get(m[1]) ?? new Set();
    if (room.size >= MAX_PEERS) return ws.close(1013, "room full");
    room.add(ws);
    rooms.set(m[1], room);
    ws.on("message", (data, isBinary) => {
      for (const peer of room) if (peer !== ws && peer.readyState === 1) peer.send(data, { binary: isBinary });
    });
    ws.on("close", () => {
      room.delete(ws);
      if (!room.size) rooms.delete(m[1]);
    });
  });
  return new Promise((resolve) => http.listen(port, () => resolve({ http, wss, port })));
}

if (import.meta.url === `file://${process.argv[1]}`) startRelay().then(({ port }) => console.log(`Lumen relay listening on :${port}`));
