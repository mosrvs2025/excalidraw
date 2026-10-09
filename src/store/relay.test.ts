// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
// @ts-expect-error plain ESM server file
import { startRelay } from "../../server/relay.mjs";

let srv: any;
let port = 0;
beforeAll(async () => {
  srv = await startRelay(0);
  port = srv.http.address().port;
});
afterAll(() => srv.http.close());

const open = (room: string) =>
  new Promise<WebSocket>((res, rej) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/room/${room}`);
    ws.on("open", () => res(ws));
    ws.on("error", rej);
  });
const next = (ws: WebSocket, ms = 400) =>
  new Promise<string | null>((res) => {
    const t = setTimeout(() => res(null), ms);
    ws.once("message", (d) => (clearTimeout(t), res(String(d))));
  });

describe("relay", () => {
  it("forwards to peers in the same room only, never echoes", async () => {
    const [a, b, c] = await Promise.all([open("roomaaaaaaaa"), open("roomaaaaaaaa"), open("roombbbbbbbb")]);
    const gotB = next(b);
    const gotA = next(a);
    const gotC = next(c);
    a.send(JSON.stringify({ t: "hello" }));
    expect(await gotB).toContain("hello");
    expect(await gotA).toBeNull();
    expect(await gotC).toBeNull();
    [a, b, c].forEach((w) => w.close());
  });
  it("rejects malformed room ids", async () => {
    await expect(
      new Promise((res, rej) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/room/x`);
        ws.on("close", (code) => res(code));
        ws.on("error", rej);
      }),
    ).resolves.toBe(1008);
  });
});
