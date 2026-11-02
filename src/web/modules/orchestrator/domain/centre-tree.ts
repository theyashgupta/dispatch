import { activeSessionView } from "../../../../shared/active-session.js";
import { SESSION_STATES } from "../../../../shared/session-states.js";
import {
  groupOwner,
  mainOrchestrator,
} from "../../../../shared/orchestrator-owner.js";
import type {
  Card,
  OrchestratorView,
  SupervisorState,
} from "../../../../shared/types.js";
import {
  isShipped,
  recordStatus,
  statusOf,
  type BranchState,
  type BranchTone,
} from "./centre-graph.js";

export interface TreeStatus {
  state: BranchState | null;
  sessionState: SupervisorState | null;
  label: string;
  tone: BranchTone;
}

export interface TreeGroup {
  id: string;
  identifier: string;
  title: string;
  status: TreeStatus;
  unitCount: number;
  dashed: boolean;
}

export interface TreeOrchestrator {
  id: string;
  focusId: string;
  name: string;
  role: "main" | "extra";
  status: TreeStatus;
  groups: TreeGroup[];
}

export interface TreeEdge {
  from: string;
  to: string;
  dashed: boolean;
}

export interface CentreTree {
  orchestrators: TreeOrchestrator[];
  edges: TreeEdge[];
}

function treeGroup(card: Card): TreeGroup {
  const session = activeSessionView(card);
  const s = statusOf(card, session);
  const state = session?.state;
  return {
    id: card.id,
    identifier: card.identifier,
    title: card.title,
    status: {
      state: s.state,
      sessionState:
        state !== undefined &&
        (s.band === "running" ||
          (s.band === "needs_you" && SESSION_STATES[state].label === s.label))
          ? state
          : null,
      label: s.label,
      tone: s.tone,
    },
    unitCount: card.loopProgress?.units.length ?? 0,
    dashed: s.state === "planned",
  };
}

function treeOrchestrator(
  record: OrchestratorView,
  groups: TreeGroup[],
): TreeOrchestrator {
  const stopped = record.state === "stopped" || record.state === "stopping";
  const { label, tone } = recordStatus(record);
  return {
    id: record.id,
    focusId: `orch:${record.id}`,
    name: record.name,
    role: record.role,
    status: {
      state: null,
      sessionState: stopped ? null : (record.session?.state ?? null),
      label,
      tone,
    },
    groups,
  };
}

/**
 * Build the board-wide orchestrator tree: the main first, then the extras in record order, each with the group cards it owns.
 *
 * @remarks Ownership comes from `groupOwner`, so a stale stored owner never moves a group. Hidden and shipped groups get no node.
 */
export function centreTree(input: {
  cards: readonly Card[];
  records: readonly OrchestratorView[];
}): CentreTree {
  const main = mainOrchestrator(input.records);
  const ordered = [
    ...(main === undefined ? [] : [main]),
    ...input.records.filter((r) => r.role === "extra"),
  ];
  const groups = input.cards
    .filter((card) => card.source === "group" && !isShipped(card))
    .sort(
      (a, b) =>
        a.identifier.localeCompare(b.identifier, undefined, {
          numeric: true,
        }) || a.id.localeCompare(b.id),
    );
  const orchestrators = ordered.map((record) =>
    treeOrchestrator(
      record,
      groups
        .filter((card) => groupOwner(input.records, card) === record.id)
        .map(treeGroup),
    ),
  );
  return {
    orchestrators,
    edges: orchestrators.flatMap((o) =>
      o.groups.map((g) => ({ from: o.id, to: g.id, dashed: g.dashed })),
    ),
  };
}

/** Give the keyboard focus order of the tree: each orchestrator, then its groups. */
export function treeFocusOrder(tree: CentreTree): string[] {
  return tree.orchestrators.flatMap((o) => [
    o.focusId,
    ...o.groups.map((g) => g.id),
  ]);
}
