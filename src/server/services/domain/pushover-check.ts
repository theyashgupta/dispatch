import type { EnvPresence } from "../../../shared/types.js";

export const PUSHOVER_NAMES = [
  "PUSHOVER_USER_KEY",
  "PUSHOVER_APP_TOKEN",
] as const;

export type PushoverName = (typeof PUSHOVER_NAMES)[number];

/**
 * List the Pushover names that stop a phase notification from being sent.
 *
 * @remarks When every name is unset, notifications are off and nothing is missing. An unset name
 * counts as missing once any other name is declared.
 */
export function missingPushover(
  presence: Record<PushoverName, EnvPresence>,
): PushoverName[] {
  if (PUSHOVER_NAMES.every((name) => presence[name] === "unset")) return [];
  return PUSHOVER_NAMES.filter((name) => presence[name] !== "filled");
}

/**
 * Build the one start-up log line for missing Pushover names, or null when none is missing.
 */
export function pushoverStartLine(
  missing: readonly PushoverName[],
): string | null {
  if (missing.length === 0) return null;
  const verb = missing.length === 1 ? "is" : "are";
  return `[notify] loop phase notifications are on, but ${missing.join(" and ")} ${verb} empty or not set, so no phase notification is sent`;
}
