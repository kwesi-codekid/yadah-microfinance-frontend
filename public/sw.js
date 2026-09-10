/*
 * The service worker behind browser push. It does one thing: when the push
 * service hands it a message the API sent, it shows it, and when the person
 * taps it, it opens the record the notification points at. There is no
 * caching and no offline behaviour here on purpose — the app stays live.
 *
 * Payload shape, as the API sends it: `{ title, body, url?, tag? }`. Anything
 * else falls back to a generic line so a malformed push still shows up.
 */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

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
    icon: "/logo.png",
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
