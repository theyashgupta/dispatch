import type {
  TerminalAppearance,
  UserProfile,
} from "../../../../shared/types.js";
import { http, httpError } from "@/lib/http";
import {
  isPushSupported,
  postPushSubscription,
  subscribeWithServerKey,
  writeMarker,
} from "@/queries/push-api";

/**
 * Read the persisted cleanup delay: GET /api/config/cleanup-delay.
 *
 * @remarks
 * Throws on any non-2xx.
 */
export async function getCleanupDelay(): Promise<{ cleanupDelayDays: number }> {
  const result = await http<{ cleanupDelayDays: number }>(
    "/api/config/cleanup-delay",
  );
  if (!result.ok) {
    throw httpError("getCleanupDelay", result);
  }
  return result.data;
}

/**
 * Persist the cleanup delay: PUT /api/config/cleanup-delay.
 *
 * @remarks
 * A 200 resolves `{ ok: true }`, a 400 resolves `{ ok: false, error }` from the parsed body so the
 * tab shows the validation error verbatim, and any other status throws.
 */
export async function saveCleanupDelay(
  days: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await http("/api/config/cleanup-delay", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cleanupDelayDays: days }),
  });
  if (result.ok) {
    return { ok: true };
  }
  if (result.status === 400) {
    return { ok: false, error: result.error ?? "Couldn't save cleanup delay." };
  }
  throw httpError("saveCleanupDelay", result);
}

/**
 * Read the persisted terminal appearance: GET /api/config/terminal.
 *
 * @remarks
 * Throws on any non-2xx.
 */
export async function getTerminalAppearance(): Promise<TerminalAppearance> {
  const result = await http<TerminalAppearance>("/api/config/terminal");
  if (!result.ok) {
    throw httpError("getTerminalAppearance", result);
  }
  return result.data;
}

/**
 * Persist the terminal appearance: PUT /api/config/terminal.
 *
 * @remarks
 * Follows `saveCleanupDelay`'s 200, 400, throw split, so the tab can show the server's field-named
 * error verbatim.
 */
export async function saveTerminalAppearance(
  appearance: TerminalAppearance,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await http("/api/config/terminal", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(appearance),
  });
  if (result.ok) {
    return { ok: true };
  }
  if (result.status === 400) {
    return { ok: false, error: result.error ?? "invalid terminal appearance" };
  }
  throw httpError("saveTerminalAppearance", result);
}

/**
 * Read the persisted `claude` launch arguments: GET /api/config/claude-args.
 *
 * @remarks
 * Throws on any non-2xx.
 */
export async function getClaudeArgs(): Promise<{ claudeArgs: string }> {
  const result = await http<{ claudeArgs: string }>("/api/config/claude-args");
  if (!result.ok) {
    throw httpError("getClaudeArgs", result);
  }
  return result.data;
}

/**
 * Persist the `claude` launch arguments: PUT /api/config/claude-args.
 *
 * @remarks
 * Follows `saveCleanupDelay`'s 200, 400, throw split.
 */
export async function saveClaudeArgs(
  claudeArgs: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await http("/api/config/claude-args", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ claudeArgs }),
  });
  if (result.ok) {
    return { ok: true };
  }
  if (result.status === 400) {
    return {
      ok: false,
      error: result.error ?? "Couldn't save Claude arguments.",
    };
  }
  throw httpError("saveClaudeArgs", result);
}

/**
 * Read the About you profile: GET /api/config/profile.
 *
 * @remarks
 * Throws on any non-2xx.
 */
export async function getProfile(): Promise<UserProfile> {
  const result = await http<UserProfile>("/api/config/profile");
  if (!result.ok) {
    throw httpError("getProfile", result);
  }
  return result.data;
}

/**
 * Save the About you profile: PUT /api/config/profile.
 *
 * @remarks
 * A 400 carries the server's field-named message for the tab to show verbatim; any other
 * non-2xx throws. The 200 body is the normalized profile as stored.
 */
export async function saveProfile(
  profile: UserProfile,
): Promise<{ ok: true; profile: UserProfile } | { ok: false; error: string }> {
  const result = await http<UserProfile>("/api/config/profile", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(profile),
  });
  if (result.ok) {
    return { ok: true, profile: result.data };
  }
  if (result.status === 400) {
    return { ok: false, error: result.error ?? "Invalid profile" };
  }
  throw httpError("saveProfile", result);
}

/**
 * Enable remote access: POST /api/remote/enable.
 *
 * @remarks
 * The authoritative status (starting, on, error, binary-missing) arrives over the `tunnel` SSE
 * frame, not this response. Rejects on non-2xx so the caller can log.
 */
export async function enableRemote(): Promise<void> {
  const result = await http("/api/remote/enable", { method: "POST" });
  if (!result.ok) {
    throw httpError("enableRemote", result);
  }
}

/**
 * Disable remote access: POST /api/remote/disable.
 *
 * @remarks
 * The `tunnel` SSE frame carries the resulting `off` state. Rejects on non-2xx so the caller can
 * log.
 */
export async function disableRemote(): Promise<void> {
  const result = await http("/api/remote/disable", { method: "POST" });
  if (!result.ok) {
    throw httpError("disableRemote", result);
  }
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
 * The only function in the app that may prompt, and only because a click handler calls it. Every
 * failure after `pushManager.subscribe()` unwinds the browser-side subscription, so the browser
 * never keeps one the server did not store.
 */
export async function enablePush(): Promise<PushEnableResult> {
  try {
    const registration = await navigator.serviceWorker.register("/sw.js");
    const subscription = await subscribeWithServerKey(registration);
    try {
      const result = await postPushSubscription(subscription);
      if (!result.ok) {
        await subscription.unsubscribe();
        return {
          ok: false,
          error:
            result.error === "too-many-subscriptions"
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
 * Unsubscribe this device from push, resolving `false` on failure and leaving the browser permission granted.
 *
 * @remarks
 * Never rejects, because `unsubscribe()` may reject when the push service is unreachable and a
 * rejection would strand the caller's pending UI state forever. Permission cannot be revoked
 * programmatically, so it stays granted by design.
 */
export async function disablePush(): Promise<boolean> {
  const subscription = await readPushSubscription();
  if (subscription == null) {
    writeMarker(false);
    return true;
  }
  const endpoint = subscription.endpoint;
  try {
    await subscription.unsubscribe();
  } catch {
    writeMarker(false);
    return false;
  }
  try {
    await http("/api/push/unsubscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint }),
    });
  } catch {}
  writeMarker(false);
  return true;
}
