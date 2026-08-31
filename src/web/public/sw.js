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
    /**
     * The subscription is userVisibleOnly, so a push that shows nothing spends the browser's
     * silent-push budget and can get the permission revoked; show a generic fallback instead.
     * The fixed tag collapses repeated malformed pushes into one notification, and the empty
     * cardId plus scope url route its click to the focus/open path instead of a dead end.
     */
    event.waitUntil(
      self.registration.showNotification("Dispatch", {
        body: "A card needs your input.",
        tag: "dsp-fallback",
        data: { url: self.registration.scope, cardId: "" },
        icon: "/icon-192.png",
      }),
    );
    return;
  }
  /**
   * `tag: data.cardId` is the PUSH-05 dedup contract: it must stay equal to the card id so this
   * push and the in-tab `new Notification(..., { tag: card.id })` in
   * src/web/hooks/useTransitionNotifications.ts coalesce into one visible notification when a tab
   * is open. Changing either tag scheme silently reintroduces double-notify.
   */
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
  const hasCard = typeof cardId === "string" && cardId !== "";
  if (!hasCard && typeof url !== "string") return;
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
        if (hasCard) existing.postMessage({ type: "dsp-open-card", cardId });
      } else if (
        typeof url === "string" &&
        new URL(url).origin === self.location.origin
      ) {
        await clients.openWindow(url);
      }
    })(),
  );
});
