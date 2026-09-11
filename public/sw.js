/*
 * The service worker. It has two jobs.
 *
 * 1. Browser push: when the push service hands it a message the API sent, it
 *    shows it, and when the person taps it, it opens the record the
 *    notification points at.
 *
 * 2. Making the app installable, and saying something useful when an
 *    installed copy is opened with no network.
 *
 * What it deliberately does NOT do is cache the app. Every figure in Yadah is
 * read live from the office, and a stale balance served from a cache is worse
 * than no balance at all — so nothing here intercepts data, assets or
 * documents. The one thing kept on the device is the offline page below, plus
 * the icon it draws, because by definition they cannot be fetched at the
 * moment they are needed.
 *
 * Push payload shape, as the API sends it: `{ title, body, url?, tag? }`.
 * Anything else falls back to a generic line so a malformed push still shows up.
 */

/* Bump this to retire the previous cache on the next activation. */
const CACHE = "yadah-shell-v1";
const OFFLINE_URL = "/offline.html";
const PRECACHE = [OFFLINE_URL, "/icons/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      // The offline page is a courtesy; push is not. If it cannot be stored,
      // install anyway and let the browser draw its own error page instead.
      .catch(() => {})
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Without this, taking over navigations costs a worker start-up on every
      // page load. With it, the browser races the network request in parallel.
      if (self.registration.navigationPreload) {
        await self.registration.navigationPreload.enable();
      }
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)));
      await self.clients.claim();
    })(),
  );
});

/*
 * Page loads only. A client-side navigation inside the app is a `.data` fetch,
 * not a navigation request, so it never reaches here — which is the point:
 * data keeps failing loudly, the way the screens already expect it to.
 */
self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;

  event.respondWith(
    (async () => {
      try {
        const preloaded = await event.preloadResponse;
        return preloaded || (await fetch(event.request));
      } catch {
        // Offline, or the office is unreachable. Either way there is no page
        // to show, so show the one we kept.
        const cached = await caches.match(OFFLINE_URL);
        return cached || Response.error();
      }
    })(),
  );
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data ? event.data.text() : "" };
  }
  const title = payload.title || "Yadah Dynamic Enterprise";
  const options = {
    body: payload.body || "",
    icon: "/icons/icon-192.png",
    badge: "/favicon.ico",
    tag: payload.tag || undefined,
    data: { url: payload.url || "/notifications" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/notifications";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      for (const client of windows) {
        if ("focus" in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
