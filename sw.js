// Offline cache: app shell + Pyodide from jsDelivr (stale-while-revalidate). API calls are never cached.
const C = "pq-v1";
self.addEventListener("install", e => e.waitUntil(caches.open(C).then(c => c.addAll(["./"])).then(() => self.skipWaiting())));
self.addEventListener("activate", e => e.waitUntil(clients.claim()));
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.pathname.startsWith("/api/")) return;
  if (u.origin !== location.origin && !u.hostname.endsWith("jsdelivr.net")) return;
  e.respondWith(caches.open(C).then(async c => {
    const hit = await c.match(e.request);
    const net = fetch(e.request).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => hit);
    return hit || net;
  }));
});
