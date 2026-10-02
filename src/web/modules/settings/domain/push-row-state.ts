export type DesktopPermission =
  "granted" | "denied" | "default" | "unsupported";

export type PushRowState =
  | "ios-needs-install"
  | "unsupported"
  | "default"
  | "enabling"
  | "enabled"
  | "disabling"
  | "denied";

export type PushError = "cap" | "generic";

interface PushRowInput {
  ios: boolean;
  standalone: boolean;
  supported: boolean;
  pending: "enabling" | "disabling" | null;
  permission: DesktopPermission;
  hasSubscription: boolean | null;
}

/**
 * Pick the state of the push row from the device, the permission and the pending action.
 *
 * @remarks
 * The order is the contract: an iOS browser outside the Home Screen app cannot push at all, so it
 * outranks every other state, and a pending action outranks the permission it is about to change.
 */
export function pushRowState(input: PushRowInput): PushRowState {
  if (input.ios && !input.standalone) return "ios-needs-install";
  if (!input.supported) return "unsupported";
  if (input.pending !== null) return input.pending;
  if (input.permission === "denied") return "denied";
  if (input.permission === "granted" && input.hasSubscription === true) {
    return "enabled";
  }
  return "default";
}

/**
 * Pick the error to show after an enable attempt.
 *
 * @remarks
 * A blocked permission already has its own row, so it clears the error instead of adding a second
 * message for the same cause.
 */
export function pushEnableError(
  result:
    { ok: true } | { ok: false; error: "too-many-subscriptions" | "generic" },
  livePermission: DesktopPermission,
): PushError | null {
  if (livePermission === "denied" || result.ok) return null;
  return result.error === "too-many-subscriptions" ? "cap" : "generic";
}
