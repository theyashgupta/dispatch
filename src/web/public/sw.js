/**
 * Dispatch service worker (PUSH-09, PUSH-04, PUSH-05). Deliberately registers NO "fetch"
 * listener: its mere presence would route every navigation and sub-resource request through the
 * service worker, the exact failure this requirement exists to prevent. Push payload parsing and
 * notification display, plus notification-click routing back into the app shell, are handled
 * below (Phase 110).
 */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data;
  try {
    data = event.data ? event.data.json() : null;
  } catch {
    data = null;
  }
  if (
    data == null ||
    typeof data.title !== "string" ||
    typeof data.cardId !== "string" ||
    data.cardId === ""
  ) {
    return;
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      tag: data.cardId,
      renotify: true,
      data: { url: data.url, cardId: data.cardId },
      icon: "/icon-192.png",
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url;
  const cardId = event.notification.data?.cardId ?? event.notification.tag;
  if (typeof cardId !== "string" || cardId === "") return;
  event.waitUntil(
    (async () => {
      const all = await clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      const existing =
        typeof url === "string"
          ? all.find(
              (client) => new URL(client.url).origin === new URL(url).origin,
            )
          : all[0];
      if (existing) {
        try {
          await existing.focus();
        } catch {
          // A browser may refuse focus (no user-activation context); still route the card.
        }
        existing.postMessage({ type: "dsp-open-card", cardId });
      } else if (typeof url === "string") {
        await clients.openWindow(url);
      }
    })(),
  );
});
