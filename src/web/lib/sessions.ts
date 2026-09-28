import type {
  Card,
  Column,
  PrInfo,
  PreviewInfo,
  SessionSummary,
} from "../../shared/types.js";

export type SessionSection = "In progress" | "Needs you" | "Finished" | "Lost";

export const SESSION_SECTIONS: readonly SessionSection[] = [
  "In progress",
  "Needs you",
  "Finished",
  "Lost",
];

export interface SessionRow {
  key: string;
  cardId: string;
  identifier: string;
  title: string;
  sessionId: string;
  shortId: string;
  playbook?: string;
  account?: string;
  startedAt: string;
  lastActiveAt: string;
  elapsedMs: number;
  worktree?: string;
  prs: PrInfo[];
  previews: PreviewInfo[];
  lastMarker?: string;
  lost: boolean;
  active: boolean;
  running: boolean;
  cardLive: boolean;
  cleaningUp: boolean;
  restoreSessionId?: string;
  column: Column;
  cleanupBlocked: { repo: string; count: number }[];
  siblings: number;
}

function toRow(
  card: Card,
  s: SessionSummary,
  now: number,
  summaries: readonly SessionSummary[],
): SessionRow {
  const siblings = summaries.length;
  const started = Date.parse(s.createdAt);
  const last = Date.parse(s.updatedAt);
  const starting = card.provisioningStep != null && s.ordinal === siblings;
  const lost = s.lost && !starting;
  const finished =
    s.active && (card.column === "done" || card.column === "agent_done");
  const running = !lost && !finished;
  return {
    key: `${card.id}:${s.id}`,
    cardId: card.id,
    identifier: card.identifier,
    title: card.title,
    sessionId: s.id,
    shortId: s.id.slice(0, 8),
    playbook: card.startIntent?.playbook,
    account: s.claudeAccountId,
    startedAt: s.createdAt,
    lastActiveAt: s.updatedAt,
    elapsedMs: Math.max(0, (running ? now : last) - started),
    worktree:
      [s.workspaceFolder, s.branch].filter(Boolean).join(" · ") || undefined,
    prs: s.prs ?? [],
    previews: s.previews ?? [],
    lastMarker: s.lastMarker,
    lost,
    active: s.active,
    running,
    cardLive:
      card.provisioningStep != null ||
      summaries.some((x) => x.active && !x.lost),
    cleaningUp: card.cleaningUp === true,
    restoreSessionId: card.activeSessionId,
    column: card.column,
    cleanupBlocked: s.cleanupBlocked ?? [],
    siblings,
  };
}

/** One row per session summary across the cards; a card without summaries yields none. */
export function flattenSessions(
  cards: readonly Card[],
  now: number,
): SessionRow[] {
  return cards.flatMap((card) => {
    const summaries = card.sessionSummaries ?? [];
    return summaries.map((s) => toRow(card, s, now, summaries));
  });
}

/**
 * The section a row lands in.
 *
 * @remarks Status is the card column, which only describes the active session, so a live
 * non-active sibling reads as In progress and a lost row is Lost whatever the column says.
 */
export function sessionSection(row: SessionRow): SessionSection {
  if (row.lost) return "Lost";
  if (!row.active) return "In progress";
  if (row.column === "needs_input") return "Needs you";
  if (row.column === "agent_done" || row.column === "done") return "Finished";
  return "In progress";
}

type StatusLabel =
  "Lost" | "Working" | "To Do" | "Needs you" | "Review" | "Parked" | "Done";

const COLUMN_STATUS: Record<Column, StatusLabel> = {
  todo: "To Do",
  inbox: "To Do",
  in_progress: "Working",
  needs_input: "Needs you",
  in_review: "Review",
  parked: "Parked",
  agent_done: "Done",
  done: "Done",
};

/** The status chip label: Lost for a dead terminal, Working for a live sibling, else the column. */
export function sessionStatusLabel(row: SessionRow): StatusLabel {
  if (row.lost) return "Lost";
  if (!row.active) return "Working";
  return COLUMN_STATUS[row.column];
}

/** A compact elapsed label down to the second, so a live row visibly ticks. */
export function formatElapsed(ms: number): string {
  if (!Number.isFinite(ms)) return "";
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = String(total % 60).padStart(2, "0");
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m ${sec}s`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${total % 60}s`;
}

export interface SessionFilter {
  liveOnly: boolean;
  account: string;
  status: SessionSection | "";
  query: string;
}

/** The account ids present in the rows, sorted, for the account select. */
export function accountOptions(rows: readonly SessionRow[]): string[] {
  return [
    ...new Set(
      rows.map((r) => r.account).filter((a): a is string => a != null),
    ),
  ].sort();
}
