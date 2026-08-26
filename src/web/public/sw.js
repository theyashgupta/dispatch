/**
 * Dispatch service worker skeleton (PUSH-09). Deliberately registers NO "fetch" listener: its mere
 * presence would route every navigation and sub-resource request through the service worker, the
 * exact failure this requirement exists to prevent. Payload parsing and notification display land
 * in Phase 110; client focus/deep-link lands in Phase 109/110.
 */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", () => {});

self.addEventListener("notificationclick", () => {});
