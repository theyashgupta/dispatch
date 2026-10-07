import { http, payload } from "@/lib/http";

const PUSH_ENABLED_KEY = "dsp.push";

function readMarker(): boolean {
  try {
    return localStorage.getItem(PUSH_ENABLED_KEY) === "on";
  } catch {
    return false;
  }
}

/** Persist or clear the `dsp.push` marker; disabling removes the key rather than writing "off". */
export function writeMarker(on: boolean): void {
  try {
    if (on) {
      localStorage.setItem(PUSH_ENABLED_KEY, "on");
    } else {
      localStorage.removeItem(PUSH_ENABLED_KEY);
    }
  } catch {}
}

/**
 * Convert the server's unpadded base64url public key into the `Uint8Array` `applicationServerKey` needs.
 *
 * @remarks
 * `atob` requires padded standard base64 (`+`/`/`), while the server emits unpadded
 * base64url (`-`/`_`), so this conversion is mandatory rather than cosmetic.
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const bytes = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    bytes[i] = rawData.charCodeAt(i);
  }
  return bytes;
}

/** Whether this browser has the Notification, Service Worker, and Push Manager APIs. */
export function isPushSupported(): boolean {
  return (
    "Notification" in window &&
    "serviceWorker" in navigator &&
    "PushManager" in window
  );
}

/** Subscribe the push manager with the server's public key: GET /api/push/public-key. */
export async function subscribeWithServerKey(
  registration: ServiceWorkerRegistration,
): Promise<PushSubscription> {
  const keyResult = await http<{ publicKey: string }>("/api/push/public-key");
  const { publicKey } = payload(keyResult) as {
    publicKey: string;
  };
  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });
}

/** Hand a push subscription to the server: POST /api/push/subscribe. */
export function postPushSubscription(subscription: PushSubscription) {
  return http("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(subscription.toJSON()),
  });
}

/**
 * Re-subscribe on load if the last known state warrants it, safe to call on every app mount.
 *
 * @remarks
 * Guards on the marker and the live granted permission, because a marker-only guard would re-
 * subscribe a user who revoked permission outside the app and re-trigger the native prompt on page
 * load (PUSH-01). A refused subscribe POST is terminal, so the subscription is unwound and the
 * marker cleared so the Settings row stops claiming push is on.
 */
export async function refreshPushSubscription(): Promise<void> {
  if (
    !readMarker() ||
    !isPushSupported() ||
    Notification.permission !== "granted"
  ) {
    return;
  }
  try {
    const registration = await navigator.serviceWorker.register("/sw.js");
    const subscription = await subscribeWithServerKey(registration);
    const subscribeResult = await postPushSubscription(subscription);
    if (!subscribeResult.ok) {
      await subscription.unsubscribe().catch(() => {});
      writeMarker(false);
    }
  } catch {}
}
