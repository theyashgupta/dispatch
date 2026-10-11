import {
  activeSessionView,
  type ActiveSessionView,
} from "../../../../shared/active-session.js";
import { isHiddenCard } from "../../../../shared/hidden-card.js";
import { loopView } from "../../../../shared/loop-view.js";
import {
  cardOwner,
  mainOrchestrator,
} from "../../../../shared/orchestrator-owner.js";
import { hasLoopProgress } from "../../../../shared/running-group.js";
import { SESSION_STATES } from "../../../../shared/session-states.js";
import type {
  Card,
  DecisionItem,
  OrchestratorView,
  PlanEntry,
} from "../../../../shared/types.js";

export type BranchState =
  | "planned"
  | "running"
  | "needs_input"
  | "usage_limit"
  | "done"
  | "shipped"
  | "attention";

export type BranchTone =
  "neutral" | "muted" | "attention" | "success" | "error";

export type BranchAction =
  "open" | "reply" | "open_terminal" | "resume" | "retry_resume";

export type BandKey = "needs_you" | "running" | "planned" | "done" | "shipped";

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
  shippedAt: string | null;
  slot: number;
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
  hiddenShipped: number;
}

export interface CentreGraphInput {
  cards: readonly Card[];
  records: readonly OrchestratorView[];
  selectedId: string | null;
  decisions: readonly DecisionItem[];
  now: number;
  showOlderShipped: boolean;
}

const OLDER_SHIPPED_MS = 86_400_000;

const BANDS: readonly { key: BandKey; label: string }[] = [
  { key: "needs_you", label: "Needs you" },
  { key: "running", label: "Running" },
  { key: "planned", label: "Planned" },
  { key: "done", label: "Done" },
  { key: "shipped", label: "Shipped" },
];

type Status = Pick<CentreBranch, "state" | "label" | "tone" | "band">;

function currentPlan(
  decisions: readonly DecisionItem[],
  orchestratorId: string,
): PlanEntry[] {
  const newest = decisions
    .filter((d) => d.kind === "plan" && d.orchestratorId === orchestratorId)
    .reduce<DecisionItem | null>(
      (best, d) =>
        best === null || Date.parse(d.createdAt) > Date.parse(best.createdAt)
          ? d
          : best,
      null,
    );
  const counts =
    newest !== null &&
    (newest.state === "open" || newest.answer?.optionId === "approve");
  return counts ? (newest.plan?.entries ?? []) : [];
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
  if (card.column === "done" || card.shipFlow?.state === "done") {
    return {
      state: "shipped",
      label: "Shipped",
      tone: "muted",
      band: "shipped",
    };
  }
  if (card.column === "agent_done" || state === "roadmap_complete") {
    return {
      state: "done",
      label: "Agent done",
      tone: "success",
      band: "done",
    };
  }
  if (session === null) {
    return {
      state: "planned",
      label: "Planned",
      tone: "muted",
      band: "planned",
    };
  }
  const attention = (label: string, tone: BranchTone): Status => ({
    state: "attention",
    label,
    tone,
    band: "needs_you",
  });
  if (
    (state === "needs_input" && reason === "usage_stop") ||
    state === "usage_limit_dialog" ||
    state === "usage_limit_wait"
  ) {
    return {
      state: "usage_limit",
      label: "Usage limit",
      tone: "attention",
      band: "needs_you",
    };
  }
  if (state === "needs_input" && reason === "budget") {
    return attention("Budget reached", "attention");
  }
  if (reason === "resume_failed") return attention("Resume failed", "error");
  if (state === "needs_input") {
    return {
      state: "needs_input",
      label: "Needs input",
      tone: "attention",
      band: "needs_you",
    };
  }
  if (
    state === "stale" ||
    state === "permission_prompt" ||
    state === "api_error" ||
    state === "lost" ||
    state === "shell_prompt"
  ) {
    return attention(SESSION_STATES[state].label, SESSION_STATES[state].tone);
  }
  return {
    state: "running",
    label: "Running",
    tone: "neutral",
    band: "running",
  };
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
  if (
    state === "stale" ||
    state === "permission_prompt" ||
    state === "api_error" ||
    state === "lost" ||
    state === "shell_prompt" ||
    reason === "resume_failed"
  ) {
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

function detailOf(
  card: Card,
  status: Status,
  entry: PlanEntry | undefined,
): string | null {
  if (status.state === "running") {
    if (hasLoopProgress(card)) return loopView(card.loopProgress, {}).label;
    const phase = card.loopProgress?.summary.currentPhase;
    if (phase != null) return `Phase ${phase.number}`;
    return card.source === "group"
      ? `Group of ${card.memberIds?.length ?? 0} tickets`
      : null;
  }
  if (status.state === "planned") {
    return entry === undefined
      ? null
      : `Plan order ${entry.order}, size ${entry.size}`;
  }
  if (status.state === "done") return "Awaiting ship";
  if (status.state === "usage_limit") return "Stopped at the usage limit";
  if (status.label === "Budget reached") return "Budget reached";
  if (status.state === "needs_input") return "Needs your answer";
  return null;
}

function branchOf(card: Card, entry: PlanEntry | undefined): CentreBranch {
  const session = activeSessionView(card);
  const status = statusOf(card, session);
  return {
    id: card.id,
    cardId: card.id,
    identifier: card.identifier,
    title: card.title,
    ...status,
    actions: actionsOf(status, session),
    detail: detailOf(card, status, entry),
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
    shippedAt:
      status.state === "shipped"
        ? (card.shipFlow?.finishedAt ?? card.columnSince ?? card.updatedAt)
        : null,
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
    detail: `Plan order ${entry.order}, size ${entry.size}`,
    contextPercent: null,
    cost: null,
    playbook: entry.playbook,
    planOrder: entry.order,
    planSize: entry.size,
    memberCount: null,
    stateSince: null,
    shippedAt: null,
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

function centreNode(
  record: OrchestratorView,
  branches: readonly CentreBranch[],
  visible: readonly CentreBranch[],
): CentreNode {
  const state = record.session?.state ?? null;
  const known =
    state === null
      ? record.state === "stopped"
        ? { label: "Stopped", tone: "muted" as const }
        : { label: "Starting", tone: "neutral" as const }
      : SESSION_STATES[state];
  return {
    id: record.id,
    name: record.name,
    role: record.role,
    label: known.label,
    tone: known.tone,
    contextPercent: record.session?.contextPercent ?? null,
    cost: record.session?.cost ?? null,
    branchCount: branches.length,
    needYouCount: visible.filter((b) => b.band === "needs_you").length,
  };
}

/**
 * Builds the centre graph of the selected orchestrator: its branches, bands, edges and centre node.
 *
 * @remarks
 * The slot of a branch comes from the plan order and the ticket number only, never from
 * its state, so a branch that changes state keeps its place.
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
      hiddenShipped: 0,
    };
  }
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
    if (!isRunByOrchestrator(card, entry)) continue;
    if (entry !== undefined) matched.add(entry);
    all.push(branchOf(card, entry));
  }
  for (const entry of entries) {
    if (!matched.has(entry)) all.push(plannedBranch(entry));
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
  const hidden = (b: CentreBranch) =>
    !input.showOlderShipped &&
    b.shippedAt !== null &&
    input.now - Date.parse(b.shippedAt) > OLDER_SHIPPED_MS;
  const visible = all.filter((b) => !hidden(b));
  return {
    centre: centreNode(selected, all, visible),
    branches: visible,
    bands: BANDS.map((band) => {
      const branches = visible.filter((b) => b.band === band.key);
      return { ...band, branches, count: branches.length };
    }),
    edges: visible.map((b) => ({
      from: "centre",
      to: b.id,
      band: b.band,
      dashed: b.state === "planned",
    })),
    hiddenShipped: all.length - visible.length,
  };
}
