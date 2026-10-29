import {
  activeSessionView,
  type ActiveSessionView,
} from "../../../../shared/active-session.js";
import { isHiddenCard } from "../../../../shared/hidden-card.js";
import { loopView } from "../../../../shared/loop-view.js";
import {
  cardOwner,
  mainOrchestrator,
  scopeLabel,
} from "../../../../shared/orchestrator-owner.js";
import { hasLoopProgress } from "../../../../shared/running-group.js";
import {
  SESSION_STATES,
  type SessionTone,
} from "../../../../shared/session-states.js";
import type {
  Card,
  DecisionItem,
  OrchestratorView,
  PlanEntry,
} from "../../../../shared/types.js";

export type BranchState =
  "planned" | "running" | "needs_input" | "usage_limit" | "done" | "attention";

export type BranchTone = SessionTone;

export type BranchAction =
  "open" | "reply" | "open_terminal" | "resume" | "retry_resume";

export type BandKey = "needs_you" | "running" | "planned" | "done";

export interface CentreBranch {
  id: string;
  cardId: string | null;
  identifier: string | null;
  title: string;
  state: BranchState;
  label: string;
  tone: BranchTone;
  band: BandKey;
  actions: BranchAction[];
  detail: string | null;
  contextPercent: number | null;
  cost: number | null;
  playbook: string | null;
  planOrder: number | null;
  planSize: PlanEntry["size"] | null;
  memberCount: number | null;
  stateSince: string | null;
  slot: number;
  budget?: number | null;
}

export interface CentreNode {
  id: string;
  name: string;
  role: "main" | "extra";
  label: string;
  tone: BranchTone;
  contextPercent: number | null;
  cost: number | null;
  branchCount: number;
  needYouCount: number;
  scope: string;
}

export interface CentreBand {
  key: BandKey;
  label: string;
  branches: CentreBranch[];
  count: number;
}

export interface CentreEdge {
  from: "centre";
  to: string;
  band: BandKey;
  dashed: boolean;
}

export interface CentreGraph {
  centre: CentreNode | null;
  branches: CentreBranch[];
  bands: CentreBand[];
  edges: CentreEdge[];
}

export interface CentreGraphInput {
  cards: readonly Card[];
  records: readonly OrchestratorView[];
  selectedId: string | null;
  decisions: readonly DecisionItem[];
  now: number;
  timeZone?: string;
}

interface Clock {
  now: number;
  timeZone: string | undefined;
}

const BANDS: readonly { key: BandKey; label: string }[] = [
  { key: "needs_you", label: "Needs you" },
  { key: "running", label: "Running" },
  { key: "planned", label: "Planned" },
  { key: "done", label: "Done" },
];

type Status = Pick<CentreBranch, "state" | "label" | "tone" | "band">;

const ATTENTION_STATES = [
  "stale",
  "frozen",
  "permission_prompt",
  "api_error",
  "lost",
  "shell_prompt",
] as const;

const isAttentionState = (
  state: string | undefined,
): state is (typeof ATTENTION_STATES)[number] =>
  (ATTENTION_STATES as readonly (string | undefined)[]).includes(state);

const status = (
  state: BranchState,
  label: string,
  tone: BranchTone,
  band: BandKey,
): Status => ({ state, label, tone, band });

const planDetail = (entry: PlanEntry): string =>
  `Plan order ${entry.order}, size ${entry.size}`;

const newestOf = (items: readonly DecisionItem[]): DecisionItem | undefined =>
  items.reduce<DecisionItem | undefined>(
    (best, d) =>
      best === undefined || Date.parse(d.createdAt) > Date.parse(best.createdAt)
        ? d
        : best,
    undefined,
  );

/**
 * The plan entries of one orchestrator: the newest approved plan, then a newer open plan as a preview.
 *
 * @remarks The approved plan keeps its orders, so a new proposal never reorders the work that runs;
 * an entry only the open plan names follows them. A rejected plan adds nothing.
 */
function currentPlan(
  decisions: readonly DecisionItem[],
  orchestratorId: string,
): PlanEntry[] {
  const plans = decisions.filter(
    (d) => d.kind === "plan" && d.orchestratorId === orchestratorId,
  );
  const approved = newestOf(
    plans.filter((d) => d.answer?.optionId === "approve"),
  );
  const open = newestOf(
    plans.filter(
      (d) =>
        d.state === "open" &&
        (approved === undefined ||
          Date.parse(d.createdAt) > Date.parse(approved.createdAt)),
    ),
  );
  const base = approved?.plan?.entries ?? [];
  const last = Math.max(0, ...base.map((e) => e.order));
  const known = new Set(base.map((e) => e.ref));
  const preview = (open?.plan?.entries ?? [])
    .filter((e) => !known.has(e.ref))
    .map((e) => ({ ...e, order: last + e.order }));
  return [...base, ...preview];
}

function entryOf(
  entries: readonly PlanEntry[],
  card: Card,
): PlanEntry | undefined {
  return entries.find(
    (e) =>
      e.ref === card.id ||
      e.ref === card.identifier ||
      (card.source === "group" && e.ref === card.title),
  );
}

function isRunByOrchestrator(card: Card, entry: PlanEntry | undefined) {
  return (
    card.source === "group" ||
    card.activeSessionId !== undefined ||
    (card.sessions?.length ?? 0) > 0 ||
    (card.sessionSummaries?.length ?? 0) > 0 ||
    card.launch !== undefined ||
    card.startIntent !== undefined ||
    card.createdByOrchestrator !== undefined ||
    card.ownerOrchestrator !== undefined ||
    entry !== undefined
  );
}

function statusOf(card: Card, session: ActiveSessionView | null): Status {
  const state = session?.state;
  const reason = session?.stateReason;
  if (card.column === "agent_done" || state === "roadmap_complete") {
    return status("done", "Agent done", "success", "done");
  }
  if (session === null) return status("planned", "Planned", "muted", "planned");
  if (
    (state === "needs_input" && reason === "usage_stop") ||
    state === "usage_limit_dialog" ||
    state === "usage_limit_wait"
  ) {
    return status("usage_limit", "Usage limit", "attention", "needs_you");
  }
  if (state === "needs_input" && reason === "budget") {
    return status("attention", "Budget reached", "attention", "needs_you");
  }
  if (reason === "resume_failed") {
    return status("attention", "Resume failed", "error", "needs_you");
  }
  if (state === "needs_input") {
    return status("needs_input", "Needs input", "attention", "needs_you");
  }
  if (isAttentionState(state)) {
    const { label, tone } = SESSION_STATES[state];
    return status("attention", label, tone, "needs_you");
  }
  return status("running", "Running", "neutral", "running");
}

function actionsOf(
  status: Status,
  session: ActiveSessionView | null,
): BranchAction[] {
  const state = session?.state;
  const reason = session?.stateReason;
  const actions: BranchAction[] = ["open"];
  if (status.band !== "needs_you") return actions;
  if (status.state === "needs_input" || state === "stale") {
    actions.push("reply");
  }
  if (isAttentionState(state) || reason === "resume_failed") {
    actions.push("open_terminal");
  }
  if (
    state === "needs_input" &&
    (reason === "usage_stop" || reason === "budget")
  ) {
    actions.push("resume");
  }
  if (reason === "resume_failed") actions.push("retry_resume");
  return actions;
}

/**
 * Format an ISO time as "HH:MM" on the day of `now`, else as "D MMM HH:MM", both on a 24-hour clock.
 *
 * @remarks The day is compared in the given zone, the local zone when none is given, so the text matches the clock the user reads.
 */
function timeText(iso: string, clock: Clock): string | null {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return null;
  const { timeZone } = clock;
  const day = (ms: number) =>
    new Date(ms).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone,
    });
  const time = new Date(at).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  });
  if (day(at) === day(clock.now)) return time;
  const date = new Date(at).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone,
  });
  return `${date} ${time}`;
}

const isShipped = (card: Card): boolean =>
  card.column === "done" || card.shipFlow?.state === "done";

function detailOf(
  card: Card,
  status: Status,
  entry: PlanEntry | undefined,
  session: ActiveSessionView | null,
  clock: Clock,
): string | null {
  const reason = session?.stateReason;
  if (status.state === "running") {
    if (hasLoopProgress(card)) return loopView(card.loopProgress, {}).label;
    const phase = card.loopProgress?.summary.currentPhase;
    if (phase != null) return `Phase ${phase.number}`;
    return card.source === "group"
      ? `Group of ${card.memberIds?.length ?? 0} tickets`
      : null;
  }
  if (status.state === "planned") {
    return entry === undefined ? null : planDetail(entry);
  }
  if (status.state === "done") {
    const time = timeText(
      session?.stateSince ?? card.columnSince ?? card.updatedAt,
      clock,
    );
    return time === null ? "Awaiting ship" : `Done ${time}, awaiting ship`;
  }
  if (status.state === "usage_limit") return "Stopped at the usage limit";
  if (status.state === "attention" && reason === "budget") {
    return "Budget reached";
  }
  if (status.state === "needs_input") return "Needs your answer";
  return null;
}

function branchOf(
  card: Card,
  entry: PlanEntry | undefined,
  clock: Clock,
): CentreBranch {
  const session = activeSessionView(card);
  const status = statusOf(card, session);
  return {
    id: card.id,
    cardId: card.id,
    identifier: card.identifier,
    title: card.title,
    ...status,
    actions: actionsOf(status, session),
    detail: detailOf(card, status, entry, session, clock),
    contextPercent: session?.contextPercent ?? null,
    cost: session?.cost ?? null,
    playbook:
      card.launch?.playbook ??
      card.startIntent?.playbook ??
      entry?.playbook ??
      null,
    planOrder: entry?.order ?? null,
    planSize: entry?.size ?? null,
    memberCount: card.source === "group" ? (card.memberIds?.length ?? 0) : null,
    stateSince: session?.stateSince ?? null,
    slot: 0,
  };
}

function plannedBranch(entry: PlanEntry): CentreBranch {
  return {
    id: `plan:${entry.order}`,
    cardId: null,
    identifier: null,
    title: entry.ref,
    state: "planned",
    label: "Planned",
    tone: "muted",
    band: "planned",
    actions: [],
    detail: planDetail(entry),
    contextPercent: null,
    cost: null,
    playbook: entry.playbook,
    planOrder: entry.order,
    planSize: entry.size,
    memberCount: null,
    stateSince: null,
    slot: 0,
  };
}

function numberOf(identifier: string | null): number {
  const match = /(\d+)$/.exec(identifier ?? "");
  return match === null ? Number.POSITIVE_INFINITY : Number(match[1]);
}

function compare(x: number, y: number): number {
  return x === y ? 0 : x < y ? -1 : 1;
}

const RECORD_STATES: Partial<
  Record<OrchestratorView["state"], { label: string; tone: BranchTone }>
> = {
  stopped: { label: "Stopped", tone: "muted" },
  stopping: { label: "Stopping", tone: "muted" },
};

const STARTING = { label: "Starting", tone: "neutral" } as const;

function centreNode(
  record: OrchestratorView,
  branches: readonly CentreBranch[],
  cards: readonly Card[],
): CentreNode {
  const state = record.session?.state ?? null;
  const known =
    RECORD_STATES[record.state] ??
    (state === null ? STARTING : SESSION_STATES[state]);
  return {
    id: record.id,
    name: record.name,
    role: record.role,
    label: known.label,
    tone: known.tone,
    contextPercent: record.session?.contextPercent ?? null,
    cost: record.session?.cost ?? null,
    branchCount: branches.length,
    needYouCount: branches.filter((b) => b.band === "needs_you").length,
    scope: scopeLabel(record, cards),
  };
}

/**
 * Build the centre graph of the selected orchestrator: its branches, bands, edges and centre node.
 *
 * @remarks
 * The slot of a branch comes from the plan order and the ticket number only, never from
 * its state, so a branch that changes state keeps its place. A shipped card gets no branch:
 * shipped work lives in the activity feed and the board Done column.
 */
export function centreGraph(input: CentreGraphInput): CentreGraph {
  const selected =
    input.records.find((r) => r.id === input.selectedId) ??
    mainOrchestrator(input.records);
  const emptyBands = BANDS.map((b) => ({ ...b, branches: [], count: 0 }));
  if (selected === undefined) {
    return {
      centre: null,
      branches: [],
      bands: emptyBands,
      edges: [],
    };
  }
  const clock = { now: input.now, timeZone: input.timeZone };
  const entries = currentPlan(input.decisions, selected.id);
  const matched = new Set<PlanEntry>();
  const all: CentreBranch[] = [];
  for (const card of input.cards) {
    if (
      isHiddenCard(card) ||
      card.groupId !== undefined ||
      cardOwner(input.records, card, undefined) !== selected.id
    ) {
      continue;
    }
    const entry = entryOf(entries, card);
    if (!isRunByOrchestrator(card, entry) || isShipped(card)) continue;
    if (entry !== undefined) matched.add(entry);
    all.push(branchOf(card, entry, clock));
  }
  for (const entry of entries) {
    const onBoard = input.cards.some((card) => entryOf([entry], card));
    if (!matched.has(entry) && !onBoard) all.push(plannedBranch(entry));
  }
  all
    .sort(
      (a, b) =>
        compare(
          a.planOrder ?? Number.POSITIVE_INFINITY,
          b.planOrder ?? Number.POSITIVE_INFINITY,
        ) ||
        compare(numberOf(a.identifier), numberOf(b.identifier)) ||
        a.id.localeCompare(b.id),
    )
    .forEach((branch, index) => {
      branch.slot = index;
    });
  return {
    centre: centreNode(selected, all, input.cards),
    branches: all,
    bands: BANDS.map((band) => {
      const branches = all.filter((b) => b.band === band.key);
      return { ...band, branches, count: branches.length };
    }),
    edges: all.map((b) => ({
      from: "centre",
      to: b.id,
      band: b.band,
      dashed: b.state === "planned",
    })),
  };
}
