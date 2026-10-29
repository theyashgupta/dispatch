import type { Board, OrchestratorRecord } from "../../../../shared/types.js";

export interface SidebarOrchestrator {
  hasOrchestrator: boolean;
  hasMain: boolean;
  label: "Orchestrator" | "Add orchestrator";
  state: OrchestratorRecord["state"];
  stateLabel: "Running" | "Starting" | "Stopping" | "Stopped";
  needsYou: number;
  badge: number | null;
  canStart: boolean;
}

const STATE_LABELS: Record<
  OrchestratorRecord["state"],
  SidebarOrchestrator["stateLabel"]
> = {
  running: "Running",
  starting: "Starting",
  stopping: "Stopping",
  stopped: "Stopped",
};

/** The orchestrator sidebar entry of a board: its label, main state, needs-you count and whether Start applies. */
export function sidebarOrchestrator(
  board: Pick<Board, "orchestrators" | "policy"> | null,
  needsYouCount: number,
): SidebarOrchestrator | null {
  if (board === null) return null;
  const main = board.orchestrators.find((o) => o.role === "main");
  const state = main?.state ?? "stopped";
  const hasOrchestrator = board.orchestrators.length > 0;
  return {
    hasOrchestrator,
    hasMain: main !== undefined,
    label: hasOrchestrator ? "Orchestrator" : "Add orchestrator",
    state,
    stateLabel: STATE_LABELS[state],
    needsYou: needsYouCount,
    badge: hasOrchestrator && needsYouCount > 0 ? needsYouCount : null,
    canStart: board.policy.supervisor === "on" && state === "stopped",
  };
}
