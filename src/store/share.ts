/**
 * Serverless sharing: a whole board packed into a URL fragment (gzip + base64url).
 * The fragment never reaches any server, so a link is private by construction.
 * Opening one imports the board as a new local project — the same seam a cloud room would later use.
 */
const PREFIX = "#board=";
export const MAX_LINK_CHARS = 180_000;

const toB64Url = (buf: Uint8Array) => {
  let s = "";
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const fromB64Url = (s: string) => {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};

async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream) {
  const source = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(data);
      c.close();
    },
  });
  const out = new Response(source.pipeThrough(stream as unknown as ReadableWritablePair<Uint8Array, Uint8Array>));
  return new Uint8Array(await out.arrayBuffer());
}

export async function encodeBoard(elements: readonly any[], name = "Shared board") {
  const live = elements.filter((e) => !e.isDeleted);
  const json = JSON.stringify({ v: 1, name, elements: live });
  const zipped = await pipe(new TextEncoder().encode(json), new CompressionStream("gzip"));
  return PREFIX + toB64Url(zipped);
}

export async function decodeBoard(hash: string): Promise<{ name: string; elements: any[] } | null> {
  if (!hash.startsWith(PREFIX)) return null;
  try {
    const raw = await pipe(fromB64Url(hash.slice(PREFIX.length)), new DecompressionStream("gzip"));
    const parsed = JSON.parse(new TextDecoder().decode(raw));
    if (parsed?.v !== 1 || !Array.isArray(parsed.elements)) return null;
    return { name: String(parsed.name || "Shared board").slice(0, 80), elements: parsed.elements.slice(0, 5000) };
  } catch {
    return null;
  }
}
