import type {
  BoardKey,
  BoardPolicy,
  Card,
  LoopProgress,
  OrchestrationEvent,
} from "../../../shared/types.js";
import { capturePane } from "../../adapters/tmux.js";
import {
  redactCard,
  boardRepository as store,
} from "../../store/board-repository.js";
import { ConflictError, ValidationError } from "../domain/errors.js";
import { effectivePolicy } from "../domain/orchestrator-rules.js";
import type { OrchestratorIdentity } from "../domain/orchestrator-scope.js";
import { loadPlaybooks } from "../infra/playbooks.js";
import { runningLoops } from "./boards.js";

export type CapturePane = (target: string) => Promise<string>;

export const paneReader: { capture: CapturePane } = { capture: capturePane };

/** A group card and its members, redacted for the wire; any other card has no members. */
export function cardWithMembers(card: Card): {
  card: Card;
  members: Card[];
} {
  return {
    card: redactCard(card),
    members:
      card.source === "group" ? store.membersOf(card.id).map(redactCard) : [],
  };
}

/** The loop progress of a group card, or the typed 400 for any other card. */
export function groupProgress(card: Card): {
  cardId: string;
  loopProgress: LoopProgress | null;
} {
  if (card.source !== "group") throw new ValidationError("not-group-card");
  return { cardId: card.id, loopProgress: card.loopProgress ?? null };
}

/**
 * The last `lines` lines of the card's live terminal, without the blank rows below the cursor.
 *
 * @remarks A card with no active tmux session, or a pane that cannot be captured, is the same 409,
 * since both mean there is no terminal to read.
 */
export async function paneTail(
  card: Card,
  lines: number,
): Promise<{ cardId: string; sessionId: string; lines: string[] }> {
  const session = card.sessions?.find((s) => s.id === card.activeSessionId);
  if (!session?.tmuxSession || card.provisioningStep != null) {
    throw new ConflictError("no-live-session");
  }
  const text = await paneReader
    .capture(`=${session.tmuxSession}:`)
    .catch(() => null);
  if (text === null) throw new ConflictError("no-live-session");
  const rows = text.split("\n");
  while (rows.length > 0 && rows[rows.length - 1]?.trim() === "") rows.pop();
  return { cardId: card.id, sessionId: session.id, lines: rows.slice(-lines) };
}

/** The orchestration events of one board after `since`, oldest first, with the cursor to ask next. */
export function eventsAfter(
  board: BoardKey,
  since: number,
  limit: number,
): { events: OrchestrationEvent[]; cursor: number } {
  const events = store.listOrchestrationEvents(board, since, limit);
  return { events, cursor: events.at(-1)?.id ?? since };
}

const sessionCosts = new Map<string, { last: number; base: number }>();

/**
 * The cost of one session across claude restarts: a meter that drops below its last value started again from zero.
 *
 * @remarks The status line cost belongs to the current claude process, so a relaunch resets it.
 * The total lives in server memory and starts again after a server restart.
 */
function runningCost(sessionId: string, meter: number): number {
  const seen = sessionCosts.get(sessionId) ?? { last: 0, base: 0 };
  const base = meter < seen.last ? seen.base + seen.last : seen.base;
  sessionCosts.set(sessionId, { last: meter, base });
  return base + meter;
}

/**
 * The cost of a group: the sum of its sessions' running costs (U2-22).
 *
 * @remarks Every read is one observation of each meter, so the supervisor budget stop and the
 * orchestrator checks share one total that a relaunch does not reset.
 */
export function groupCost(card: Card): number {
  return (card.sessions ?? []).reduce(
    (sum, s) => sum + runningCost(s.id, s.cost ?? 0),
    0,
  );
}

/**
 * The caller's effective policy with the running group count, group costs and playbook names.
 *
 * @remarks
 * The effective policy is the board policy narrowed by the caller's override.
 */
export async function policySummary({
  boardKey: board,
  orchestratorId,
}: OrchestratorIdentity): Promise<{
  policy: BoardPolicy | null;
  runningLoops: number;
  concurrencyCap: number | null;
  groups: { cardId: string; cost: number; budget: number | null }[];
  playbooks: string[];
}> {
  const stored = store.getBoard(board);
  const policy = stored
    ? effectivePolicy(
        stored.policy,
        stored.orchestrators.find((r) => r.id === orchestratorId),
      )
    : null;
  const groups = store.listCards(board).filter((c) => c.source === "group");
  return {
    policy,
    runningLoops: runningLoops(board),
    concurrencyCap: policy?.concurrencyCap ?? null,
    groups: groups.map((card) => ({
      cardId: card.id,
      cost: groupCost(card),
      budget: policy?.budgetPerGroup ?? null,
    })),
    playbooks: (await loadPlaybooks()).map((p) => p.name),
  };
}
