import type { CalendarErrorCode, CalendarPermission } from "./types.js";

const BY_STATUS: Record<number, CalendarPermission> = {
  0: "not-asked",
  1: "restricted",
  2: "denied",
  3: "granted",
  4: "write-only",
};

/**
 * Map a raw EventKit authorization status to its permission state.
 *
 * @remarks Anything outside 0 to 4, and a null status, is `unknown` so a garbled answer never reads as a state.
 */
export function permissionFromStatus(raw: number | null): CalendarPermission {
  return (raw === null ? undefined : BY_STATUS[raw]) ?? "unknown";
}

/**
 * Map a permission state other than granted to the read error code that reports it.
 *
 * @remarks `denied` keeps the `calendar-denied` code; every other state uses its own name.
 */
export function permissionErrorCode(
  permission: Exclude<CalendarPermission, "granted">,
): CalendarErrorCode {
  return permission === "denied" ? "calendar-denied" : permission;
}
