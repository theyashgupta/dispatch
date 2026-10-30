import { mainOrchestrator } from "../../../../shared/orchestrator-owner.js";
import { dollars, spentOfBudget } from "../../../../shared/cost-text.js";
import type { CentreBranch } from "./centre-graph.js";
import {
  stripPeriod,
  type ControlKind,
  type OrchestratorView,
} from "./centre-model.js";

export const NO_ORCHESTRATOR_TEXT = "This board has no orchestrator.";
export const NO_BRANCHES_TEXT =
  "No tickets or groups yet. Ask the orchestrator in the terminal.";
export const LOADING_TEXT = "Loading command centre";
export const CENTRE_SETTINGS_BUTTON_ID = "centre-settings-button";
export const CENTRE_TERMINAL_BUTTON_ID = "centre-terminal-button";
export const CENTRE_TERMINAL_CLOSE_ID = "centre-terminal-close";
const NOT_STARTED_TEXT = "Not started";

export const OPEN_TERMINAL_LABEL = "Open terminal";

export const CENTRE_CONTROL_LABELS: Record<ControlKind, string> = {
  start: "Start",
  stop: "Stop",
  resume: "Resume",
};

export type RegionState = "loading" | "error" | "empty" | "ready";

/** Build the counts line of the centre node, for example "3 branches, 1 need you". */
export function countsText(branchCount: number, needYouCount: number): string {
  const noun = branchCount === 1 ? "branch" : "branches";
  return `${branchCount} ${noun}, ${needYouCount} need you`;
}

/** Build the context meter text of a tile. */
export function contextText(percent: number): string {
  return `Context ${Math.round(percent)}%`;
}

/** Build the cost line of the centre node. */
export function costText(cost: number): string {
  return `${dollars(cost)} today`;
}

/** Build the playbook line of a tile. */
export function playbookText(name: string): string {
  return `Playbook ${name}`;
}

/**
 * Build the meter texts of a tile: context and cost, or "Not started" for a planned branch with no session.
 *
 * @remarks A branch that runs but has no reading yet shows no meter, so a tile never claims "Not started" for a live session.
 */
export function tileMeters(
  branch: Pick<CentreBranch, "state" | "contextPercent" | "cost" | "budget">,
): string[] {
  if (
    branch.state === "planned" &&
    branch.contextPercent === null &&
    branch.cost === null
  ) {
    return [NOT_STARTED_TEXT];
  }
  return [
    ...(branch.contextPercent === null
      ? []
      : [contextText(branch.contextPercent)]),
    ...(branch.cost === null
      ? []
      : [spentOfBudget(branch.cost, branch.budget ?? null)]),
  ];
}

/**
 * Pick the display state of one region.
 *
 * @remarks An error wins over loading, so one failed input shows the alert and not a skeleton. The caller passes `error` only for a query that has no data, so the last data stays on screen after a failed refetch.
 */
export function regionState(input: {
  loading: boolean;
  error: boolean;
  empty: boolean;
}): RegionState {
  if (input.error) return "error";
  if (input.loading) return "loading";
  return input.empty ? "empty" : "ready";
}

/** Build the error line of a region that did not load. */
export function regionErrorText(region: string, message: string): string {
  return `${region} did not load: ${stripPeriod(message)}.`;
}

/** Tell whether the switcher shows, which takes two or more orchestrators. */
export function showSwitcher(records: readonly OrchestratorView[]): boolean {
  return records.length > 1;
}

/** Build the switcher options, one per orchestrator. */
export function switcherOptions(
  records: readonly OrchestratorView[],
): { value: string; label: string }[] {
  return records.map((r) => ({
    value: r.id,
    label: `${r.name} (${r.role === "main" ? "Main" : "Extra"})`,
  }));
}

/** Tell whether the path names an orchestrator that is not in the records. */
export function unknownOrchestrator(
  records: readonly OrchestratorView[],
  id: string | undefined,
): boolean {
  return id !== undefined && !records.some((r) => r.id === id);
}

/** Pick the record the path names, or the main orchestrator when the path names none. */
export function selectedRecord(
  records: readonly OrchestratorView[],
  id: string | undefined,
): OrchestratorView | null {
  return id === undefined
    ? (mainOrchestrator(records) ?? null)
    : (records.find((r) => r.id === id) ?? null);
}

/** Build the label of the Orchestrators settings tab, with the count once the records loaded. */
export function orchestratorsTabLabel(count: number | null): string {
  return count === null ? "Orchestrators" : `Orchestrators (${count})`;
}
