import type {
  Card,
  ShipBranch,
  ShipBranchState,
  ShipFlow,
} from "../../../../shared/types.js";

type Tone = "success" | "danger" | "neutral";

export interface ShipBadge {
  label: string;
  glyph: string;
  tone: Tone;
}

export interface ShipBranchRow {
  order: number;
  name: string;
  pr: string;
  state: ShipBadge;
  checks: ShipBadge;
  identity: ShipBadge;
}

export interface ShipBlock {
  cardId: string;
  groupId: string;
  flow: { label: string; glyph: string };
  failed: string | null;
  branches: ShipBranchRow[];
}

const STATES: Record<ShipBranchState, { label: string; glyph: string }> = {
  queued: { label: "Queued", glyph: "CircleDashed" },
  merging_main: { label: "Merging main", glyph: "GitCompare" },
  checking: { label: "Checking", glyph: "ListChecks" },
  pushing: { label: "Pushing", glyph: "Upload" },
  waiting_checks: { label: "Waiting for checks", glyph: "LoaderCircle" },
  waiting_merge: { label: "Waiting for your merge", glyph: "GitPullRequest" },
  merging: { label: "Merging", glyph: "GitMerge" },
  verifying: { label: "Verifying", glyph: "UserCheck" },
  merged: { label: "Merged", glyph: "CircleCheck" },
  failed: { label: "Failed", glyph: "CircleX" },
};

const FLOWS: Record<ShipFlow["state"], { label: string; glyph: string }> = {
  running: { label: "Running", glyph: "Play" },
  stopped: { label: "Stopped", glyph: "CircleStop" },
  done: { label: "Done", glyph: "CircleCheck" },
};

const CHECKS: Record<"null" | "pending" | "passed" | "failed", ShipBadge> = {
  null: { label: "Not started", glyph: "Minus", tone: "neutral" },
  pending: { label: "Pending", glyph: "LoaderCircle", tone: "neutral" },
  passed: { label: "Passing", glyph: "Check", tone: "success" },
  failed: { label: "Failing", glyph: "X", tone: "danger" },
};

const IDENTITY: Record<"null" | "passed" | "failed", ShipBadge> = {
  null: { label: "Not checked yet", glyph: "CircleMinus", tone: "neutral" },
  passed: { label: "Author verified", glyph: "ShieldCheck", tone: "neutral" },
  failed: { label: "Author mismatch", glyph: "UserX", tone: "danger" },
};

function branchRow(branch: ShipBranch, index: number): ShipBranchRow {
  const state = STATES[branch.state];
  return {
    order: index + 1,
    name: branch.name,
    pr: branch.pr === null ? "-" : `#${branch.pr}`,
    state: {
      ...state,
      tone:
        branch.state === "merged"
          ? "success"
          : branch.state === "failed"
            ? "danger"
            : "neutral",
    },
    checks: CHECKS[branch.checks ?? "null"],
    identity: IDENTITY[branch.identity ?? "null"],
  };
}

function failedText(flow: ShipFlow): string | null {
  if (flow.state !== "stopped") return null;
  const step =
    flow.failedStep === null ? "" : ` at ${STATES[flow.failedStep].label}`;
  const reason = flow.reason === null ? "" : `: ${flow.reason}`;
  return `Stopped${step}${reason}`;
}

/** Builds one ship block per group card with a ship flow, in the order the flows started. */
export function shipBlocks(cards: readonly Card[]): ShipBlock[] {
  return cards
    .flatMap((card) =>
      card.shipFlow === undefined ? [] : [{ card, flow: card.shipFlow }],
    )
    .sort((a, b) => Date.parse(a.flow.startedAt) - Date.parse(b.flow.startedAt))
    .map(({ card, flow }) => ({
      cardId: card.id,
      groupId: card.identifier,
      flow: FLOWS[flow.state],
      failed: failedText(flow),
      branches: flow.branches.map(branchRow),
    }));
}
