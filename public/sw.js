// Lumen service worker: app shell + anything you've used is available offline.
// Hashed build assets are immutable (cache-first); everything else revalidates in the background.
const CACHE = "lumen-v1";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) =>
  e.waitUntil(
    (async () => {
      for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
      await self.clients.claim();
    })(),
  ),
);
// the page tells us what it has loaded so far, so the very first visit is already offline-capable
self.addEventListener("message", (e) => {
  if (e.data?.type !== "precache") return;
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(e.data.urls.map((u) => c.add(u).catch(() => {})))));
});
self.addEventListener("fetch", (e) => {
  const r = e.request;
  const u = new URL(r.url);
  if (r.method !== "GET" || u.origin !== location.origin || u.pathname.startsWith("/api/")) return;
  if (r.mode === "navigate") {
    e.respondWith(
      fetch(r)
        .then((res) => (res.ok && caches.open(CACHE).then((c) => c.put("/", res.clone())), res))
        .catch(() => caches.match("/", { ignoreVary: true })),
    );
    return;
  }
  e.respondWith(
    caches.match(r, { ignoreVary: true }).then((hit) => {
      const net = fetch(r)
        .then((res) => (res.ok && caches.open(CACHE).then((c) => c.put(r, res.clone())), res))
        .catch(() => hit);
      return hit || net;
    }),
  );
});
