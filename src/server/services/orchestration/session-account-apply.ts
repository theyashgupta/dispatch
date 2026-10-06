import {
  DEFAULT_CLAUDE_ACCOUNT_ID,
  type AccountApplyResult,
  type ApplyChoice,
  type SessionRef,
} from "../../../shared/types.js";
import { hasSession, sessionEnvHas } from "../../adapters/tmux.js";
import { boardRepository as store } from "../../store/board-repository.js";
import { readRegistry } from "./claude-accounts.js";
import { planApply, type PlanSession } from "./session-account-plan.js";
import {
  moveSessionAccount,
  sendContinuePrompt,
  sessionOf,
  type MoveCause,
  type MoveSeen,
  type SessionMoveOutcome,
} from "./session-account-move.js";
import { liveTurnState } from "./session-turn.js";
import { SHELL_SESSION_ENV } from "./steps.js";

const PENDING_SWEEP_MS = 30_000;

const settles = (outcome: SessionMoveOutcome): boolean =>
  outcome !== "busy" && outcome !== "limit-unknown";

const automaticQueued = new Map<string, SessionRef>();

const refKey = (cardId: string, sessionId: string): string =>
  `${cardId}:${sessionId}`;

async function isKnownAccount(accountId: string): Promise<boolean> {
  return (
    accountId === DEFAULT_CLAUDE_ACCOUNT_ID ||
    (await readRegistry()).some((a) => a.id === accountId)
  );
}

async function planSessions(): Promise<PlanSession[]> {
  return Promise.all(
    store.sessionsWithTmux().map(async ({ card, session }) => {
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

async function tryMove(
  ref: SessionRef,
  targetId: string,
  cause: MoveCause,
  seen: MoveSeen = {},
): Promise<SessionMoveOutcome | "error"> {
  try {
    return await moveSessionAccount(
      ref.cardId,
      targetId,
      ref.sessionId,
      cause,
      seen,
    );
  } catch (err) {
    console.warn(
      `[account-move] move failed for card ${ref.cardId}: ${(err as Error).message}`,
    );
    return "error";
  }
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
    const outcome = await tryMove(ref, targetId, "switch");
    if (outcome === "moved") result.moved.push(ref);
    else if (outcome === "busy" && choice === "all") plan.queue.push(ref);
    else result.skipped.push({ ...ref, reason: outcome });
  }
  for (const ref of plan.queue) {
    await store.setPendingAccount(ref.cardId, ref.sessionId, targetId);
    automaticQueued.delete(refKey(ref.cardId, ref.sessionId));
    result.queued.push(ref);
  }
  return result;
}

/**
 * Type `Continue.` after a move that left a limit surface on screen and reached a ready Claude.
 */
async function continueAfterMove(
  ref: SessionRef,
  seen: MoveSeen,
): Promise<void> {
  if (seen.leftLimit !== true || seen.ready === false) return;
  await sendContinuePrompt(ref.cardId, ref.sessionId);
}

/**
 * Point each unpinned queued move that targets `fromId` at `targetId`, and return those sessions.
 *
 * @remarks A chain-queued move keeps its chain tracking, so it still gets `Continue.` and the pin
 * check when it runs.
 */
async function retargetPendingMoves(
  fromId: string,
  targetId: string,
): Promise<SessionRef[]> {
  const retargeted: SessionRef[] = [];
  for (const { card, session } of store.sessionsWithTmux()) {
    if (
      session.pendingClaudeAccountId !== fromId ||
      session.accountPinned === true
    ) {
      continue;
    }
    await store.setPendingAccount(card.id, session.id, targetId);
    retargeted.push({ cardId: card.id, sessionId: session.id });
  }
  return retargeted;
}

/**
 * Move the sessions of one account to another for the chain, queueing the busy ones.
 *
 * @remarks A queued move to `fromId` is re-targeted and any other queued move is left alone, so a
 * second failover inside one busy turn never strands a session. A session whose step throws lands
 * in `skipped` as `error`, so it never strands the rest.
 * @see docs/ARCHITECTURE.md#account-chain
 */
export async function applyAutomaticMove(
  fromId: string,
  targetId: string,
): Promise<AccountApplyResult> {
  const result: AccountApplyResult = { moved: [], queued: [], skipped: [] };
  result.queued.push(...(await retargetPendingMoves(fromId, targetId)));
  const sessions: PlanSession[] = [];
  for (const s of await planSessions()) {
    if (s.accountId !== fromId) continue;
    const pending = pendingOf(s.cardId, s.sessionId);
    if (pending !== undefined && pending !== targetId) continue;
    if (sessionOf(s.cardId, s.sessionId)?.accountPinned === true) {
      result.skipped.push({
        cardId: s.cardId,
        sessionId: s.sessionId,
        reason: "pinned",
      });
    } else sessions.push(s);
  }
  const plan = planApply(sessions, "all", targetId);
  result.skipped.push(...plan.skip);
  const pinned = (ref: SessionRef): boolean =>
    sessionOf(ref.cardId, ref.sessionId)?.accountPinned === true;
  for (const ref of plan.move) {
    if (pinned(ref)) {
      result.skipped.push({ ...ref, reason: "pinned" });
      continue;
    }
    try {
      const seen: MoveSeen = {};
      const outcome = await tryMove(ref, targetId, "automatic move", seen);
      if (outcome === "busy") plan.queue.push(ref);
      else if (outcome !== "moved") {
        result.skipped.push({ ...ref, reason: outcome });
      } else {
        await continueAfterMove(ref, seen);
        result.moved.push(ref);
      }
    } catch (err) {
      skipFailed(result, ref, err);
    }
  }
  for (const ref of plan.queue) {
    if (pinned(ref)) {
      result.skipped.push({ ...ref, reason: "pinned" });
      continue;
    }
    try {
      await store.setPendingAccount(ref.cardId, ref.sessionId, targetId);
      automaticQueued.set(refKey(ref.cardId, ref.sessionId), ref);
      result.queued.push(ref);
    } catch (err) {
      skipFailed(result, ref, err);
    }
  }
  return result;
}

function skipFailed(
  result: AccountApplyResult,
  ref: SessionRef,
  err: unknown,
): void {
  console.warn(
    `[account-move] automatic move failed for card ${ref.cardId}: ${(err as Error).message}`,
  );
  result.skipped.push({ ...ref, reason: "error" });
}

/**
 * Drop every queued move the chain made, for `autoMove` turned off.
 */
export async function clearAutomaticPendingMoves(): Promise<void> {
  for (const [key, ref] of [...automaticQueued]) {
    automaticQueued.delete(key);
    await store.setPendingAccount(ref.cardId, ref.sessionId, undefined);
  }
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
  automaticQueued.delete(refKey(cardId, targetId));
  return "queued";
}

/**
 * Run a session's queued move, if it has one, and clear it once the move settles.
 *
 * @remarks A `busy` or `limit-unknown` outcome keeps the queued move for the next try, and the
 * clear is skipped when a newer move was queued while this one ran. A chain-queued move is dropped
 * when the session is now pinned, and gets `Continue.` when it left a limit surface.
 */
export async function runPendingMove(
  cardId: string,
  sessionId: string,
): Promise<void> {
  const pending = pendingOf(cardId, sessionId);
  if (pending === undefined) return;
  const key = refKey(cardId, sessionId);
  const automatic = automaticQueued.has(key);
  if (automatic && sessionOf(cardId, sessionId)?.accountPinned === true) {
    automaticQueued.delete(key);
    await store.setPendingAccount(cardId, sessionId, undefined);
    return;
  }
  const seen: MoveSeen = {};
  const outcome = await moveSessionAccount(
    cardId,
    pending,
    sessionId,
    "turn end",
    seen,
  );
  if (!settles(outcome)) return;
  automaticQueued.delete(key);
  if (automatic && outcome === "moved") {
    await continueAfterMove({ cardId, sessionId }, seen);
  }
  if (pendingOf(cardId, sessionId) === pending) {
    await store.setPendingAccount(cardId, sessionId, undefined);
  }
}

function pendingOf(cardId: string, sessionId: string): string | undefined {
  return sessionOf(cardId, sessionId)?.pendingClaudeAccountId;
}

/**
 * Run the queued move of every live session that has one.
 */
export async function sweepPendingMoves(): Promise<void> {
  for (const { card, session } of store.sessionsWithTmux()) {
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
