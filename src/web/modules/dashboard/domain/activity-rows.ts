import type {
  Card,
  GroupState,
  OrchestrationEvent,
  OrchestrationEventKind,
  OrchestratorRecord,
  SupervisorState,
} from "../../../../shared/types.js";
import { SESSION_STATES } from "../../../../shared/session-states.js";
import { clock } from "./usage-meters.js";

export const ACTIVITY_PAGE_SIZE = 20;

export type ActivityActorFilter = "all" | "orchestrator" | "supervisor" | "you";

type ActorKind = "Orchestrator" | "Supervisor" | "You";

export type ActivityTone = "danger" | "warn" | "ok" | "muted";

export interface ActivityRow {
  id: number;
  time: string;
  actor: string;
  text: string;
  line: string;
  tone: ActivityTone;
  emphasis: { start: number; end: number } | null;
}

const ACTORS: Record<OrchestrationEventKind, ActorKind> = {
  tool_call: "Orchestrator",
  decision_raised: "Orchestrator",
  decision_answered: "You",
  supervisor_action: "Supervisor",
  supervisor_state: "Supervisor",
  loop_gate: "Supervisor",
  pr_state: "Supervisor",
  machine_wake: "Supervisor",
  intake_submitted: "You",
  group_state: "Supervisor",
};

const GROUP_STATE_LABELS: Record<GroupState, string> = {
  agent_done: "reached Agent done",
  needs_input: "needs input",
  start_failed: "failed to start",
  shipped: "shipped",
  ship_stopped: "ship stopped",
  loop_error: "loop error",
  usage_limit: "hit a usage limit",
};

const SUPERVISOR_ACTIONS: Record<string, (g: string) => string> = {
  continue: (g) => `sent one continue prompt to ${g}`,
  limit_wait: () => "selected wait at the usage limit dialog",
  limit_escape: (g) => `left the usage limit prompt of ${g}`,
  answer_prompt: (g) => `answered a prompt of ${g}`,
  resume: (g) => `resumed ${g}`,
  relaunch_frozen: (g) => `relaunched frozen ${g} with resume`,
  handoff_request: (g) => `requested a handoff from ${g}`,
  handoff_cancel: (g) => `cancelled the handoff of ${g}`,
  close_loop: (g) => `closed the loop of ${g}`,
  budget_release: (g) => `released the budget stop of ${g}`,
  budget_warning: (g) => `warned that ${g} is near its budget`,
  needs_input: (g) => `moved ${g} to Needs input`,
  start_group: (g) => `started ${g}`,
  start_group_failed: (g) => `could not start ${g}`,
};

/** Looks up an action copy by own key, so `constructor` or `toString` from event data reads as unknown. */
function supervisorAction(action: string) {
  return Object.hasOwn(SUPERVISOR_ACTIONS, action)
    ? SUPERVISOR_ACTIONS[action]
    : undefined;
}

const GROUP_STATE_TONES: Record<string, ActivityTone> = {
  loop_error: "danger",
  start_failed: "danger",
  ship_stopped: "danger",
  needs_input: "warn",
  usage_limit: "warn",
  agent_done: "ok",
  shipped: "ok",
};

const ACTION_TONES: Record<string, ActivityTone> = {
  start_group_failed: "danger",
  needs_input: "warn",
  budget_warning: "warn",
};

function toneFrom(
  table: Record<string, ActivityTone>,
  key: string | null,
): ActivityTone {
  return key !== null && Object.hasOwn(table, key) ? table[key] : "muted";
}

function toneOf(event: OrchestrationEvent): ActivityTone {
  const { data } = event;
  switch (event.kind) {
    case "loop_gate":
      return data.result === "fail" ? "danger" : "ok";
    case "group_state":
      return toneFrom(GROUP_STATE_TONES, str(data.state));
    case "supervisor_action":
      return toneFrom(ACTION_TONES, str(data.action));
    case "supervisor_state":
      return data.to === "needs_input" ? "warn" : "muted";
    default:
      return "muted";
  }
}

function str(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function prSummary(data: Record<string, unknown>, group: string): string {
  const before = new Map(
    Array.isArray(data.from) ? (data.from as [number, string][]) : [],
  );
  const changed = (
    Array.isArray(data.to) ? (data.to as [number, string][]) : []
  )
    .filter(([number, state]) => before.get(number) !== state)
    .map(([number, state]) => `PR #${number} is ${state} for ${group}`);
  return changed.length > 0
    ? changed.join(", ")
    : `the PRs of ${group} changed`;
}

function textOf(event: OrchestrationEvent, group: string | null): string {
  const { data } = event;
  const g = group ?? "a card";
  switch (event.kind) {
    case "tool_call": {
      const tool = str(data.tool) ?? "tool";
      const result = str(data.result);
      return `${tool}${group === null ? "" : ` to ${group}`}${result === null ? "" : `: ${result}`}`;
    }
    case "loop_gate": {
      const outcome = data.result === "fail" ? "failed" : "passed";
      return `phase ${typeof data.phase === "number" ? data.phase : "?"} gate ${outcome} on ${g}`;
    }
    case "supervisor_state": {
      const to = str(data.to);
      const label =
        to !== null && Object.hasOwn(SESSION_STATES, to)
          ? SESSION_STATES[to as SupervisorState].label
          : (to ?? "unknown");
      return `${g} is now ${label}`;
    }
    case "supervisor_action": {
      const action = str(data.action) ?? "action";
      if (action === "orchestrator_wake") {
        const reasons = Array.isArray(data.reasons)
          ? data.reasons.filter((r): r is string => typeof r === "string")
          : [];
        const verb = data.result === "unconfirmed" ? "Could not wake" : "Woke";
        return `${verb} ${str(data.orchestrator) ?? g}: ${reasons.join(", ")}`;
      }
      return supervisorAction(action)?.(g) ?? `${action} on ${g}`;
    }
    case "decision_raised":
      return `raised a decision for ${g}`;
    case "decision_answered":
      return `answered a decision for ${g}`;
    case "pr_state":
      return prSummary(data, g);
    case "machine_wake":
      return "the machine woke";
    case "intake_submitted":
      return "submitted a goal to the orchestrator";
    case "group_state": {
      const state = str(data.state);
      const label =
        state !== null && Object.hasOwn(GROUP_STATE_LABELS, state)
          ? GROUP_STATE_LABELS[state as GroupState]
          : (state ?? "changed state");
      return `${g} ${label}`;
    }
  }
}

function actorName(
  event: OrchestrationEvent,
  orchestrators: readonly Pick<OrchestratorRecord, "id" | "name" | "role">[],
): string {
  const actor = ACTORS[event.kind];
  if (actor !== "Orchestrator") return actor;
  const id = str(event.data.orchestratorId);
  const extra = orchestrators.find((r) => r.id === id && r.role === "extra");
  return extra === undefined ? actor : `Extra orchestrator ${extra.name}`;
}

/** Finds the first whole-token occurrence of an identifier, so LOCAL-1 does not match inside LOCAL-10. */
function identifierIndex(line: string, identifier: string): number {
  const isPart = (char: string | undefined) =>
    char !== undefined && /[A-Za-z0-9-]/.test(char);
  for (
    let at = line.indexOf(identifier);
    at >= 0;
    at = line.indexOf(identifier, at + 1)
  ) {
    if (!isPart(line[at - 1]) && !isPart(line[at + identifier.length])) {
      return at;
    }
  }
  return -1;
}

/** Titles the activity section with the time of its oldest shown row. */
export function changedSinceTitle(rows: readonly ActivityRow[]): string {
  const time = rows.at(-1)?.time ?? "";
  return time === "" ? "Changed since" : `Changed since ${time}`;
}

/**
 * Turns orchestration events into activity log rows, newest first.
 *
 * @remarks `line` joins the actor and the text: a known supervisor action reads as a sentence, every other row as "<actor>: <text>". The actor filter and the group filter run before the page cut, so a page never holds
 * rows that the filter hides. A group filter keeps events of the group card and of its members.
 */
export function activityRows(
  events: readonly OrchestrationEvent[],
  cards: readonly Card[],
  filter: {
    actor: ActivityActorFilter;
    groupId?: string;
    timeZone?: string;
    orchestrators?: readonly Pick<OrchestratorRecord, "id" | "name" | "role">[];
  },
): ActivityRow[] {
  const byId = new Map(cards.map((card) => [card.id, card]));
  return events
    .filter((event) => {
      const actor = ACTORS[event.kind];
      if (filter.actor !== "all" && actor.toLowerCase() !== filter.actor) {
        return false;
      }
      if (filter.groupId === undefined) return true;
      const card = event.cardId === null ? undefined : byId.get(event.cardId);
      return card?.id === filter.groupId || card?.groupId === filter.groupId;
    })
    .sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts) || b.id - a.id)
    .map((event) => {
      const actor = actorName(event, filter.orchestrators ?? []);
      const text = textOf(
        event,
        (event.cardId === null ? undefined : byId.get(event.cardId))
          ?.identifier ?? null,
      );
      const verbPhrase =
        event.kind === "supervisor_action" &&
        supervisorAction(str(event.data.action) ?? "") !== undefined;
      const line = verbPhrase ? `${actor} ${text}` : `${actor}: ${text}`;
      const identifier =
        event.cardId === null ? undefined : byId.get(event.cardId)?.identifier;
      const start =
        identifier === undefined ? -1 : identifierIndex(line, identifier);
      return {
        id: event.id,
        time: clock(event.ts, filter.timeZone, false) ?? "",
        actor,
        text,
        line,
        tone: toneOf(event),
        emphasis:
          identifier === undefined || start < 0
            ? null
            : { start, end: start + identifier.length },
      };
    });
}
