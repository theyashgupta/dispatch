import type { UpdateRunResult } from "../../../../shared/types.js";

export const MANUAL_COMMAND = "npm i -g @theyashgupta/dispatch@latest";

export type RunPhase =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "success"; version: string }
  | { kind: "error"; command: string };

interface RunPhaseInput {
  pending: boolean;
  failed: boolean;
  result: UpdateRunResult | undefined;
}

/**
 * Turn the state of the run-update request into the phase the Updates tab shows.
 *
 * @remarks
 * A refused update with no command of its own, and a request that failed outright, both fall back
 * to the manual command so the user always has a next step.
 */
export function runPhaseFrom({
  pending,
  failed,
  result,
}: RunPhaseInput): RunPhase {
  if (pending) return { kind: "pending" };
  if (failed) return { kind: "error", command: MANUAL_COMMAND };
  if (!result) return { kind: "idle" };
  return result.ok
    ? { kind: "success", version: result.version }
    : { kind: "error", command: result.command || MANUAL_COMMAND };
}
