import type { SupervisorState } from "../../../shared/types.js";

/**
 * True when a stored `released` state holds, so the supervisor leaves the session alone.
 *
 * @remarks Released means Claude exited on purpose, so no detection plans a resume or a group error.
 * The hold ends when a relaunch goes through `runClaude`, or when the pane clearly shows Claude, as after a hand-typed `claude`.
 */
export function holdsReleased(
  stored: SupervisorState | null,
  claudeShown: boolean,
): boolean {
  return stored === "released" && !claudeShown;
}
