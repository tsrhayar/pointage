/* Pointage service worker: precached app shell, works fully offline.
   Bump VERSION whenever you change index.html, CSS, JS or icons so installed apps pick up the update.
   (Your data is in localStorage, never in this cache, so bumping VERSION never deletes it.) */
const VERSION = "v5";
const SHELL_CACHE = `pointage-shell-${VERSION}`;

// Relative to the SW location: works under http://localhost/pointage/ and https://<user>.github.io/pointage/.
const SHELL = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "assets/css/style.css",
  "assets/js/core.js",
  "assets/js/i18n.js",
  "assets/js/sync.js",
  "assets/js/vendor/lz-string.min.js",
  "assets/js/vendor/qrcode.min.js",
  "assets/js/vendor/jsQR.min.js",
  "assets/js/app.js",
  "assets/icons/favicon.svg",
  "assets/icons/favicon-32.png",
  "assets/icons/icon-192.png",
  "assets/icons/icon-512.png",
  "assets/icons/icon-maskable-512.png",
  "assets/icons/apple-touch-icon.png",
  "assets/icons/shortcut-punch.png",
  "assets/icons/shortcut-balance.png",
];
const abs = (p) => new URL(p, self.registration.scope).href;

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await cache.addAll(SHELL.map((p) => new Request(abs(p), { cache: "reload" })));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n.startsWith("pointage-") && n !== SHELL_CACHE).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

async function networkFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const res = await fetch(request);
    if (res && res.ok) cache.put(abs("index.html"), res.clone());
    return res;
  } catch (e) {
    return (await cache.match(abs("index.html"))) || (await cache.match(abs("./"))) || Response.error();
  }
}
async function staleWhileRevalidate(request) {
  const cache = await caches.open(SHELL_CACHE);
  const hit = await cache.match(request, { ignoreSearch: true });
  const net = fetch(request).then((res) => { if (res && res.ok) cache.put(request, res.clone()); return res; }).catch(() => null);
  return hit || (await net) || Response.error();
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) return;
  if (req.mode === "navigate") { event.respondWith(networkFirst(req)); return; }
  event.respondWith(staleWhileRevalidate(req));
});

self.addEventListener("message", (event) => { if (event.data === "skipWaiting") self.skipWaiting(); });
