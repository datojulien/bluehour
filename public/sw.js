const CACHE_VERSION = "v2";
const SHELL_CACHE = `bluehour-shell-${CACHE_VERSION}`;
const ASSET_CACHE = `bluehour-assets-${CACHE_VERSION}`;

const scopePath = new URL(self.registration.scope).pathname;
const appShell = [
  scopePath,
  `${scopePath}index.html`,
  `${scopePath}manifest.webmanifest`,
  `${scopePath}icon.svg`
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(appShell).catch(() => undefined)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => ![SHELL_CACHE, ASSET_CACHE].includes(key)).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.hostname.includes("google")) {
    return;
  }

  if (request.mode === "navigate" || url.pathname.endsWith("/index.html")) {
    event.respondWith(networkFirst(request, `${scopePath}index.html`));
    return;
  }

  if (url.pathname.includes(`${scopePath}assets/`) || url.pathname.endsWith(".svg") || url.pathname.endsWith(".webmanifest")) {
    event.respondWith(cacheFirst(request));
  }
});

async function networkFirst(request, fallbackPath) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(SHELL_CACHE);
      await cache.put(request, response.clone());
      if (fallbackPath) {
        await cache.put(fallbackPath, response.clone());
      }
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached ?? caches.match(fallbackPath);
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) {
    void fetch(request)
      .then((response) => {
        if (response.ok) {
          return caches.open(ASSET_CACHE).then((cache) => cache.put(request, response));
        }
        return undefined;
      })
      .catch(() => undefined);
    return cached;
  }

  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(ASSET_CACHE);
    await cache.put(request, response.clone());
  }
  return response;
}
