/**
 * Every browser push API call in the app lives in this module, so the permission-prompting call
 * has exactly one call site ({@link enablePush}). The prompt fires inside `pushManager.subscribe()`
 * itself, never through a separate permission-request call.
 */
const PUSH_ENABLED_KEY = "dsp.push";

function readMarker(): boolean {
  try {
    return localStorage.getItem(PUSH_ENABLED_KEY) === "on";
  } catch {
    return false;
  }
}

/** Persist or clear the `dsp.push` marker; disabling removes the key rather than writing "off". */
function writeMarker(on: boolean): void {
  try {
    if (on) {
      localStorage.setItem(PUSH_ENABLED_KEY, "on");
    } else {
      localStorage.removeItem(PUSH_ENABLED_KEY);
    }
  } catch {}
}

/**
 * Convert the server's unpadded base64url public key into the `Uint8Array` shape
 * `applicationServerKey` needs.
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

/**
 * Detect an iOS device by hardware, not by browser identity.
 *
 * @remarks
 * iPadOS 13 and later send a desktop macOS user agent by default, so a plain regex silently
 * under-detects every iPad; the `MacIntel` + multi-touch clause catches that case. Every iOS
 * browser is WebKit under Apple's policy and inherits the identical Home Screen and push
 * restrictions, so Chrome-on-iOS and Firefox-on-iOS must take the same branch as Safari.
 */
export function isIOSDevice(): boolean {
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  return navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
}

/**
 * Read the live push subscription, if any.
 *
 * @remarks
 * This is the read path the UI runs on mount. It never calls `register()`, requests
 * permission, or calls `subscribe()`: any prompting call here would be the exact failure
 * PUSH-01 forbids.
 */
export async function readPushSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    return subscription ?? null;
  } catch {
    return null;
  }
}

export type PushEnableResult =
  { ok: true } | { ok: false; error: "too-many-subscriptions" | "generic" };

/**
 * Subscribe this device to push, prompting for permission if needed.
 *
 * @remarks
 * The only function in the app that may prompt, and only because it is called from a click
 * handler. `pushManager.subscribe()` triggers the browser's native permission prompt itself
 * when permission is still `"default"`. Every failure after `pushManager.subscribe()` unwinds
 * the browser-side subscription, so the browser never keeps one the server did not store.
 */
export async function enablePush(): Promise<PushEnableResult> {
  try {
    const registration = await navigator.serviceWorker.register("/sw.js");
    const { publicKey } = (await fetch("/api/push/public-key").then((r) =>
      r.json(),
    )) as { publicKey: string };
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
    try {
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscription.toJSON()),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        await subscription.unsubscribe();
        return {
          ok: false,
          error:
            body.error === "too-many-subscriptions"
              ? "too-many-subscriptions"
              : "generic",
        };
      }
    } catch {
      await subscription.unsubscribe().catch(() => {});
      return { ok: false, error: "generic" };
    }
    writeMarker(true);
    return { ok: true };
  } catch {
    return { ok: false, error: "generic" };
  }
}

/**
 * Unsubscribe this device from push.
 *
 * @remarks
 * Never touches the browser permission: it cannot be revoked programmatically, and stays
 * granted by design. The blocked/denied row state is a separate branch.
 */
export async function disablePush(): Promise<void> {
  const subscription = await readPushSubscription();
  if (subscription == null) {
    writeMarker(false);
    return;
  }
  const endpoint = subscription.endpoint;
  await subscription.unsubscribe();
  try {
    await fetch("/api/push/unsubscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint }),
    });
  } catch {}
  writeMarker(false);
}

/**
 * Re-subscribe on load if the last known state warrants it, safe to call on every app mount.
 *
 * @remarks
 * Guards on the marker AND the live granted permission before touching any push API. A
 * marker-only guard would re-subscribe a user who revoked permission outside the app, which on
 * some browsers re-triggers the native prompt on page load, PUSH-01's exact failure condition.
 * Every failure here is swallowed silently: this is a background refresh, not a user action.
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
    const { publicKey } = (await fetch("/api/push/public-key").then((r) =>
      r.json(),
    )) as { publicKey: string };
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
    await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(subscription.toJSON()),
    });
  } catch {}
}
