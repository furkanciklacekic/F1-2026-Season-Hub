// Offline support: the site's own files are network-first (always fresh when online, cached copy when
// offline); photos and thumbnails from YouTube / formula1.com are cache-first in a size-capped cache.
const VERSION = "v1";
const SITE_CACHE = `site-${VERSION}`;
const IMAGE_CACHE = `images-${VERSION}`;
const IMAGE_LIMIT = 250;
const CORE = ["./", "index.html", "data.js", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png"];
const IMAGE_HOSTS = ["img.youtube.com", "media.formula1.com"];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(SITE_CACHE).then(cache => cache.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== SITE_CACHE && k !== IMAGE_CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function networkFirst(request) {
  const cache = await caches.open(SITE_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    return (await cache.match(request, { ignoreSearch: true }))
      || (request.mode === "navigate" ? cache.match("index.html") : Response.error());
  }
}

async function cacheFirstImage(request) {
  const cache = await caches.open(IMAGE_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok || response.type === "opaque") {
    await cache.put(request, response.clone());
    const keys = await cache.keys();
    for (const old of keys.slice(0, Math.max(0, keys.length - IMAGE_LIMIT))) await cache.delete(old);
  }
  return response;
}

self.addEventListener("fetch", event => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin === self.location.origin) event.respondWith(networkFirst(request));
  else if (IMAGE_HOSTS.includes(url.hostname)) event.respondWith(cacheFirstImage(request));
});
