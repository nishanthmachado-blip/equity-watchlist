// Service worker: makes the app installable and shows a friendly page when offline.
// Pages and app files are always fetched fresh from the server first (a cached copy is only used when offline);
// API responses (your holdings, net worth…) are never cached on the device.
const CACHE = "ew-shell-v1";
const SHELL = ["/icons/icon-192.png", "/icons/icon.svg", "/manifest.webmanifest"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
const OFFLINE = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline</title>
<body style="margin:0;font:16px system-ui;background:#f3f4f9;color:#14162e;display:grid;place-items:center;min-height:100vh;text-align:center;padding:24px">
<div><div style="font-size:44px">📡</div><h1 style="font-size:22px;margin:12px 0 6px">You are offline</h1><p style="color:#5d6280;max-width:340px">Equity Watchlist needs a connection to your server for live prices and holdings. It will reload when you are back online.</p>
<button onclick="location.reload()" style="margin-top:12px;padding:12px 20px;border:0;border-radius:12px;background:#1f2460;color:#fff;font-weight:700">Try again</button></div>
<script>addEventListener("online",()=>location.reload())</script></body>`;
self.addEventListener("fetch", e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return; // straight to the network
  if (req.mode === "navigate") { e.respondWith(fetch(req).catch(() => new Response(OFFLINE, { headers: { "Content-Type": "text/html; charset=utf-8" } }))); return; }
  if (/\.(css|js|png|svg|webmanifest)$/.test(url.pathname)) {
    e.respondWith(fetch(req).then(r => { if (r.ok && r.type === "basic" && !r.redirected) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)); } return r; }).catch(() => caches.match(req)));
  }
});
