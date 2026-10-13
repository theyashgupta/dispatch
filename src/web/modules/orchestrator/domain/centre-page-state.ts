import {
  REPLY_COPY,
  type ReplyResult,
} from "../../../../shared/decision-view.js";
import { mainOrchestrator } from "../../../../shared/orchestrator-owner.js";
import { SESSION_STATES } from "../../../../shared/session-states.js";
import type { SupervisorState } from "../../../../shared/types.js";
import type { CentreBranch } from "./centre-graph.js";
import type { ControlKind, OrchestratorView } from "./panel-model.js";

export { controlFor as centreControl } from "./panel-model.js";

export const NO_ORCHESTRATOR_TEXT = "This board has no orchestrator.";
export const NO_BRANCHES_TEXT =
  "No tickets or groups yet. Ask the orchestrator in the conversation.";
export const LOADING_TEXT = "Loading command centre";
const NOT_STARTED_TEXT = "Not started";

export const WIDE_QUERY = "(min-width: 768px)";

export const ACTION_LABELS = {
  resume: "Resume loop",
  retry_resume: "Try resume again",
  open_terminal: "Open terminal",
} as const;

export const CENTRE_CONTROL_LABELS: Record<ControlKind, string> = {
  start: "Start",
  stop: "Stop",
  resume: "Resume",
};

type RegionState = "loading" | "error" | "empty" | "ready";

export function countsText(branchCount: number, needYouCount: number): string {
  const noun = branchCount === 1 ? "branch" : "branches";
  return `${branchCount} ${noun}, ${needYouCount} need you`;
}

export function contextText(percent: number): string {
  return `Context ${Math.round(percent)}%`;
}

export function costText(cost: number): string {
  return `$${cost.toFixed(2)} today`;
}

export function playbookText(name: string): string {
  return `Playbook ${name}`;
}

/**
 * The meter texts of a tile: context and cost, or "Not started" for a planned branch with no session.
 *
 * @remarks A branch that runs but has no reading yet shows no meter, so a tile never claims "Not started" for a live session.
 */
export function tileMeters(
  branch: Pick<CentreBranch, "state" | "contextPercent" | "cost">,
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
    ...(branch.cost === null ? [] : [`$${branch.cost.toFixed(2)}`]),
  ];
}

/**
 * The display state of one region.
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

export function regionErrorText(region: string, message: string): string {
  return `${region} did not load: ${message.replace(/\.+$/, "")}.`;
}

export function showSwitcher(records: readonly OrchestratorView[]): boolean {
  return records.length > 1;
}

export function switcherOptions(
  records: readonly OrchestratorView[],
): { value: string; label: string }[] {
  return records.map((r) => ({
    value: r.id,
    label: `${r.name} (${r.role === "main" ? "Main" : "Extra"})`,
  }));
}

export function unknownOrchestrator(
  records: readonly OrchestratorView[],
  id: string | undefined,
): boolean {
  return id !== undefined && !records.some((r) => r.id === id);
}

export function selectedRecord(
  records: readonly OrchestratorView[],
  id: string | undefined,
): OrchestratorView | null {
  return id === undefined
    ? (mainOrchestrator(records) ?? null)
    : (records.find((r) => r.id === id) ?? null);
}

/**
 * The text of the Stale badge, or null while the stream is up or nothing has loaded.
 *
 * @remarks The time is a 24-hour clock in the given zone, the local zone when none is given.
 */
export function staleText(
  stale: boolean,
  updatedAt: number,
  timeZone?: string,
): string | null {
  if (!stale || updatedAt === 0) return null;
  const time = new Date(updatedAt).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  });
  return `Data from ${time}`;
}

export function replyOutcomeText(
  outcome:
    | { ok: true; result: ReplyResult | null }
    | { ok: false; error: string; reason: string | null },
  id: string,
  state: SupervisorState | undefined,
): string | null {
  if (outcome.ok) return REPLY_COPY[outcome.result ?? "unconfirmed"];
  if (outcome.error !== "session-state-refused") return null;
  const label =
    state === undefined ? "another state" : SESSION_STATES[state].label;
  return `Not sent. ${id} is now at ${label}. Open the terminal.`;
}
