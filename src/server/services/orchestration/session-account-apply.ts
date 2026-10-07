import {
  DEFAULT_CLAUDE_ACCOUNT_ID,
  type AccountApplyResult,
  type ApplyChoice,
} from "../../../shared/types.js";
import { hasSession, sessionEnvHas } from "../../adapters/tmux.js";
import { boardRepository as store } from "../../store/board-repository.js";
import { readRegistry } from "./claude-accounts.js";
import { planApply, type PlanSession } from "./session-account-plan.js";
import {
  moveSessionAccount,
  type SessionMoveOutcome,
} from "./session-account-move.js";
import { liveTurnState } from "./session-turn.js";
import { SHELL_SESSION_ENV } from "./steps.js";
import { ALL_BOARDS } from "../../../shared/board-key.js";

const PENDING_SWEEP_MS = 30_000;

const settles = (outcome: SessionMoveOutcome): boolean =>
  outcome !== "busy" && outcome !== "limit-unknown";

async function isKnownAccount(accountId: string): Promise<boolean> {
  return (
    accountId === DEFAULT_CLAUDE_ACCOUNT_ID ||
    (await readRegistry()).some((a) => a.id === accountId)
  );
}

async function planSessions(): Promise<PlanSession[]> {
  return Promise.all(
    store.sessionsWithTmux(ALL_BOARDS).map(async ({ card, session }) => {
      const target = `=${session.tmuxSession}`;
      const alive = await hasSession(target);
      return {
        cardId: card.id,
        sessionId: session.id,
        accountId: session.claudeAccountId ?? DEFAULT_CLAUDE_ACCOUNT_ID,
        lost: !alive,
        legacy: alive && !(await sessionEnvHas(target, SHELL_SESSION_ENV)),
        turn: alive
          ? await liveTurnState(card.id, session.id, session.tmuxSession)
          : "unknown",
      } satisfies PlanSession;
    }),
  );
}

/**
 * Apply an account switch to the running sessions: move the planned ones, queue the busy ones.
 *
 * @remarks Moves run one at a time because two moves on one card cannot overlap. A move that
 * returns `busy` under `all` is queued instead of skipped; any other refusal lands in `skipped`
 * with the move outcome as its reason, and a move that throws as `error`. Queued moves to another
 * account are dropped first, so a stale target never fires later.
 */
export async function applyAccountChoice(
  choice: ApplyChoice,
  targetId: string,
): Promise<AccountApplyResult> {
  const result: AccountApplyResult = { moved: [], queued: [], skipped: [] };
  await store.clearPendingAccountsExcept(targetId);
  if (choice === "none") return result;
  const plan = planApply(await planSessions(), choice, targetId);
  result.skipped.push(...plan.skip);
  for (const ref of plan.move) {
    let outcome: SessionMoveOutcome;
    try {
      outcome = await moveSessionAccount(
        ref.cardId,
        targetId,
        ref.sessionId,
        "switch",
      );
    } catch (err) {
      console.warn(
        `[account-move] move failed for card ${ref.cardId}: ${(err as Error).message}`,
      );
      result.skipped.push({ ...ref, reason: "error" });
      continue;
    }
    if (outcome === "moved") result.moved.push(ref);
    else if (outcome === "busy" && choice === "all") plan.queue.push(ref);
    else result.skipped.push({ ...ref, reason: outcome });
  }
  for (const ref of plan.queue) {
    await store.setPendingAccount(ref.cardId, ref.sessionId, targetId);
    result.queued.push(ref);
  }
  return result;
}

/**
 * Move one session now, or queue the move when the session is busy.
 *
 * @remarks `sessionId` defaults to the active session. The queued move runs on the session's next
 * `Stop` hook or on the 30 s sweep. Any outcome that settles the session drops its older queued
 * move unless a newer one was queued during the move, and an unknown account is refused before it
 * can be queued.
 */
export async function moveOrQueue(
  cardId: string,
  accountId: string,
  sessionId?: string,
): Promise<SessionMoveOutcome | "queued"> {
  if (!(await isKnownAccount(accountId))) return "account";
  const targetId = sessionId ?? store.getCard(cardId)?.activeSessionId;
  const pending =
    targetId === undefined ? undefined : pendingOf(cardId, targetId);
  const outcome = await moveSessionAccount(
    cardId,
    accountId,
    sessionId,
    "session action",
  );
  if (settles(outcome)) {
    if (
      targetId !== undefined &&
      pending !== undefined &&
      pendingOf(cardId, targetId) === pending
    ) {
      await store.setPendingAccount(cardId, targetId, undefined);
    }
    return outcome;
  }
  if (outcome !== "busy") return outcome;
  if (targetId === undefined) return "no-session";
  await store.setPendingAccount(cardId, targetId, accountId);
  return "queued";
}

/**
 * Run a session's queued move, if it has one, and clear it once the move settles.
 *
 * @remarks A `busy` or `limit-unknown` outcome keeps the queued move for the next try. The clear
 * is skipped when a newer move was queued while this one ran.
 */
export async function runPendingMove(
  cardId: string,
  sessionId: string,
): Promise<void> {
  const pending = pendingOf(cardId, sessionId);
  if (pending === undefined) return;
  const outcome = await moveSessionAccount(
    cardId,
    pending,
    sessionId,
    "turn end",
  );
  if (settles(outcome) && pendingOf(cardId, sessionId) === pending) {
    await store.setPendingAccount(cardId, sessionId, undefined);
  }
}

function pendingOf(cardId: string, sessionId: string): string | undefined {
  return store.getCard(cardId)?.sessions?.find((s) => s.id === sessionId)
    ?.pendingClaudeAccountId;
}

/**
 * Run the queued move of every live session that has one.
 */
export async function sweepPendingMoves(): Promise<void> {
  for (const { card, session } of store.sessionsWithTmux(ALL_BOARDS)) {
    if (session.pendingClaudeAccountId === undefined) continue;
    await runPendingMove(card.id, session.id).catch((err: unknown) => {
      console.warn(
        `[account-move] pending move failed for card ${card.id}: ${(err as Error).message}`,
      );
    });
  }
}

/**
 * Start the 30 s sweep of queued moves and return a function that stops it.
 *
 * @remarks Each tick schedules the next after it finishes, so two sweeps never overlap. The timer
 * is unref'd so it never holds the process open.
 */
export function startPendingMoveSweep(
  intervalMs = PENDING_SWEEP_MS,
): () => void {
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;
  const schedule = (): void => {
    if (stopped) return;
    timer = setTimeout(() => void tick(), intervalMs);
    timer.unref();
  };
  const tick = async (): Promise<void> => {
    try {
      await sweepPendingMoves();
    } finally {
      schedule();
    }
  };
  schedule();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
