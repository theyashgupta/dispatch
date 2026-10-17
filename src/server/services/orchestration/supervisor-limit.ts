import {
  DEFAULT_CLAUDE_ACCOUNT_ID,
  type Card,
  type Session,
} from "../../../shared/types.js";
import { boardRepository as store } from "../../store/board-repository.js";
import { sleep } from "../../adapters/exec.js";
import { capturePane, sendKeys } from "../../adapters/tmux.js";
import {
  CREDITS_OPTION,
  limitChoice,
  planLimitKeys,
} from "../domain/limit-surface.js";
import {
  pickHeadroomAccount,
  type BucketedCandidate,
} from "../domain/account-selection.js";
import { parseResetAt } from "../domain/supervisor-plan.js";
import { limitSurfaceOf, paneReady } from "../domain/supervisor-state.js";
import { getClaudeAccountsSettings } from "../infra/config-holder.js";
import { limitMoveCandidates } from "./account-chain.js";
import { getUsage } from "./claude-usage.js";
import {
  moveSessionAccount,
  sessionOf,
  type MoveSeen,
  type SessionMoveOutcome,
} from "./session-account-move.js";
import { isHandoffPending, runFreshSession } from "./supervisor-handoff.js";
import {
  continueText,
  giveUp,
  markNeedsInput,
  ownerPolicy,
  record,
} from "./supervisor-record.js";
import { sendConfirmed } from "./supervisor-send.js";

export interface LimitDeps {
  now: () => number;
  schedule: (run: () => void, ms: number) => void;
  usageResetAt: (session: Session) => number | null;
  cursorWaitMs: number;
  candidates?: () => Promise<BucketedCandidate[]>;
  move?: typeof moveSessionAccount;
  send?: typeof sendConfirmed;
  sendKeys?: typeof sendKeys;
  redrawMs?: number;
  fresh?: typeof runFreshSession;
}

const RESET_GRACE_MS = 2 * 60_000;
const MOVE_GUARD_MS = 30 * 60_000;
const MAX_WAIT_MS = 2 ** 31 - 1;
const FALLBACK_MS = 5 * 60 * 60_000;

type LimitWaitReason =
  "pinned" | "recent_move" | "no_headroom" | SessionMoveOutcome | "error";

const accountOf = (session: Session): string =>
  session.claudeAccountId ?? DEFAULT_CLAUDE_ACCOUNT_ID;

/** The five hour window reset of the session's account from the usage poll, if known. */
function usageResetAt(session: Session): number | null {
  const usage = getUsage(accountOf(session));
  const reset = usage.windows.find((w) => w.kind === "session")?.resetsAt;
  const at = reset ? Date.parse(reset) : Number.NaN;
  return Number.isFinite(at) ? at : null;
}

const DEFAULT_DEPS: LimitDeps = {
  now: Date.now,
  schedule: (run, ms) => {
    setTimeout(run, ms).unref?.();
  },
  usageResetAt,
  cursorWaitMs: 2_000,
};

const DEFAULT_COLLABORATORS = {
  candidates: limitMoveCandidates,
  move: moveSessionAccount,
  send: sendConfirmed,
  sendKeys,
  redrawMs: 1_000,
};

const scheduled = new Set<string>();
const limitMoves = new Map<string, number>();
const escaped = new Set<string>();

/**
 * The card and session a reset timer may still act on, or null.
 *
 * @remarks The timer fires hours after it was set, so it re-checks that the session is live, that
 * it still runs on the account it waited on when `accountId` is given, that its board still runs
 * the supervisor with the `wait` policy, and that no stop reason was set since.
 */
function liveSession(cardId: string, sessionId: string, accountId?: string) {
  const card = store.getCard(cardId);
  const session = card?.sessions?.find((s) => s.id === sessionId);
  const policy = card && ownerPolicy(card);
  return card &&
    session?.tmuxSession &&
    (accountId === undefined || accountOf(session) === accountId) &&
    session.stateReason === undefined &&
    policy?.supervisor === "on" &&
    policy.usageLimit === "wait"
    ? { card, session }
    : null;
}

/**
 * Schedule the one wait-policy action for after the limit resets.
 *
 * @remarks The reset time comes from the text, else the usage poll, else five hours after now; a
 * reset at or before now is ignored, so the timer never fires at once. One timer per session and account, and only a `continue` action checks that the session is
 * still on that account.
 */
function scheduleAfterReset(
  card: Card,
  session: Session,
  pane: string,
  mode: "continue" | "fresh",
  deps: LimitDeps,
  reason?: LimitWaitReason,
): void {
  const accountId = accountOf(sessionOf(card.id, session.id) ?? session);
  const key = `${session.id}:${accountId}`;
  if (scheduled.has(key)) return;
  const now = deps.now();
  const parsed = parseResetAt(pane, now);
  const fromText = parsed !== null && parsed > now ? parsed : null;
  const polled = fromText === null ? deps.usageResetAt(session) : null;
  const fromUsage = polled !== null && polled > now ? polled : null;
  const resetAt = fromText ?? fromUsage ?? now + FALLBACK_MS;
  const resetLine =
    fromText === null
      ? undefined
      : pane.split("\n").find((line) => parseResetAt(line, now) !== null);
  const source =
    fromText !== null
      ? resetLine?.startsWith("transcript:")
        ? "transcript"
        : "pane"
      : fromUsage !== null
        ? "usage"
        : "fallback";
  const due = resetAt + RESET_GRACE_MS;
  scheduled.add(key);
  record(card, session, {
    action: "limit_wait",
    mode,
    source,
    until: new Date(due).toISOString(),
    ...(reason === undefined ? {} : { reason }),
  });
  deps.schedule(
    () => {
      scheduled.delete(key);
      escaped.delete(session.id);
      const live = liveSession(
        card.id,
        session.id,
        mode === "continue" ? accountId : undefined,
      );
      if (live === null) return;
      if (mode === "fresh" && !isHandoffPending(live.card)) return;
      void (async () => {
        if (mode === "fresh") {
          await (deps.fresh ?? runFreshSession)(live.card, live.session);
          return;
        }
        const result = await sendConfirmed(
          live.card,
          live.session,
          continueText(live.card, live.session, "usage_limit"),
          "usage_limit",
        );
        record(live.card, live.session, {
          action: "continue",
          duty: "usage_limit",
          result,
        });
      })().catch((err: unknown) =>
        console.warn(
          `[supervisor] limit follow-up failed: ${(err as Error).message}`,
        ),
      );
    },
    Math.min(Math.max(0, due - now), MAX_WAIT_MS),
  );
}

async function cursorOnChoice(
  target: string,
  waitMs: number,
): Promise<{ ok: boolean; row: string | null }> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    const surface = limitSurfaceOf(await capturePane(target).catch(() => ""));
    if (surface?.kind === "b") {
      const row = surface.options[surface.cursor] ?? null;
      const chosen = limitChoice(surface.options);
      if (row !== null && CREDITS_OPTION.test(row)) return { ok: false, row };
      if (chosen !== null && surface.cursor === chosen)
        return { ok: true, row };
    }
    if (Date.now() >= deadline) return { ok: false, row: null };
    await sleep(100);
  }
}

/**
 * Answer the usage limit menu with the stop or wait row, then apply the board policy.
 *
 * @remarks Enter is pressed only after a fresh capture shows the cursor on the planned row and
 * that row is not a credits row (S-17); otherwise no Enter is sent and the session is
 * `needs_input`. Policy `stop` ends at `needs_input` with `usage_stop`; policy `wait` schedules
 * one continue prompt after the reset.
 */
export async function answerLimit(
  card: Card,
  session: Session,
  deps: LimitDeps = DEFAULT_DEPS,
): Promise<void> {
  const target = `=${session.tmuxSession}:`;
  const pane = await capturePane(target);
  const surface = limitSurfaceOf(pane);
  const keys = surface?.kind === "b" ? planLimitKeys(surface) : null;
  if (keys === null) {
    await giveUp(
      card,
      session,
      { action: "limit_answer", result: "no_plan" },
      "limit: no safe row",
    );
    return;
  }
  for (const key of keys.slice(0, -1)) await sendKeys(target, [key]);
  const check = await cursorOnChoice(target, deps.cursorWaitMs);
  if (!check.ok) {
    await giveUp(
      card,
      session,
      { action: "limit_answer", result: "refused", row: check.row },
      "limit: cursor not on the stop or wait row",
    );
    return;
  }
  await sendKeys(target, ["Enter"]);
  record(card, session, {
    action: "limit_answer",
    result: "answered",
    row: check.row,
  });
  const policy = ownerPolicy(card)?.usageLimit ?? "wait";
  if (policy === "stop") {
    await markNeedsInput(card, session, "usage_stop", "limit: policy stop");
    return;
  }
  if (isHandoffPending(card))
    scheduleAfterReset(card, session, pane, "fresh", deps);
  else await moveOrWait(card, session, pane, deps);
}

async function tryMove(
  card: Card,
  session: Session,
  targetId: string,
  seen: MoveSeen,
  move: typeof moveSessionAccount,
): Promise<SessionMoveOutcome | "error"> {
  try {
    return await move(card.id, targetId, session.id, "usage limit", seen);
  } catch (err) {
    console.warn(`[supervisor] limit move failed: ${(err as Error).message}`);
    return "error";
  }
}

/**
 * Move a session that stopped on the usage limit to the account with the most weekly headroom, else wait for the reset.
 *
 * @remarks A move that settles must also get the continue prompt confirmed, else the session goes
 * to `needs_input`, because the old account's reset no longer applies. A pinned session, a second
 * move inside 30 minutes and a move that does not settle wait for the reset instead.
 */
export async function moveOrWait(
  card: Card,
  session: Session,
  pane: string,
  deps: LimitDeps = DEFAULT_DEPS,
): Promise<void> {
  const io = { ...DEFAULT_COLLABORATORS, ...deps };
  const target = `=${session.tmuxSession}:`;
  const seen: MoveSeen = {};
  const wait = (reason: LimitWaitReason) => {
    if (seen.leftLimit !== true && limitSurfaceOf(pane)?.kind === "a") {
      record(card, session, {
        action: "limit_wait",
        mode: "continue",
        reason,
        auto_continue: true,
      });
      return;
    }
    scheduleAfterReset(card, session, pane, "continue", deps, reason);
  };
  const current = sessionOf(card.id, session.id) ?? session;
  if (current.accountPinned === true) return wait("pinned");
  const last = limitMoves.get(session.id);
  if (last !== undefined && deps.now() - last < MOVE_GUARD_MS)
    return wait("recent_move");
  const from = accountOf(current);
  const { thresholdPercent, hysteresisPercent } = getClaudeAccountsSettings();
  const to = pickHeadroomAccount(
    await io.candidates(),
    from,
    thresholdPercent,
    hysteresisPercent,
  );
  if (to === null) return wait("no_headroom");
  const recordMove = (result: string, extra: Record<string, unknown> = {}) =>
    record(card, session, { action: "limit_move", from, to, result, ...extra });

  await store.setPendingAccount(card.id, session.id, undefined);
  let outcome = await tryMove(card, session, to, seen, io.move);
  if (
    outcome === "busy" &&
    !card.paused &&
    !paneReady(await capturePane(target).catch(() => ""))
  ) {
    const redrawn = await io.sendKeys(target, ["C-l"]).then(
      () => true,
      () => false,
    );
    if (redrawn) {
      await sleep(io.redrawMs);
      outcome = await tryMove(card, session, to, seen, io.move);
    }
  }
  if (outcome !== "moved" && outcome !== "same") {
    recordMove(outcome);
    return wait(outcome);
  }
  limitMoves.set(session.id, deps.now());
  const liveCard = store.getCard(card.id);
  const movedSession = sessionOf(card.id, session.id);
  if (!liveCard || !movedSession) return recordMove("gone");
  let result: string = outcome;
  let confirmed = false;
  const extra: Record<string, unknown> = {};
  try {
    if (seen.ready === false) result = "not_ready";
    else {
      const sent = await io.send(
        liveCard,
        movedSession,
        continueText(liveCard, movedSession, "usage_limit"),
        "usage_limit",
      );
      extra.continue = sent;
      confirmed = sent === "confirmed";
    }
  } catch (err) {
    console.warn(
      `[supervisor] limit continue failed: ${(err as Error).message}`,
    );
    result = "error";
  }
  recordMove(result, extra);
  if (!confirmed)
    await markNeedsInput(
      liveCard,
      movedSession,
      "supervisor_gave_up",
      `limit: moved to ${to}, continue not confirmed`,
    );
}

/**
 * Leave the auto continue surface of a loop that waits for a handoff, and start it fresh after the reset.
 *
 * @remarks Escape is sent once per surface; a resumed old conversation would spend the fresh
 * context the handoff prepared. A pane with no surface only schedules the fresh start, reading the
 * reset time from the evidence as well.
 */
export async function escapeLimit(
  card: Card,
  session: Session,
  evidence: string,
  deps: LimitDeps = DEFAULT_DEPS,
): Promise<void> {
  if (escaped.has(session.id)) return;
  const target = `=${session.tmuxSession}:`;
  const pane = await capturePane(target);
  const text = `${evidence}\n${pane}`;
  const surface = limitSurfaceOf(pane);
  if (surface?.kind !== "a") {
    scheduleAfterReset(card, session, text, "fresh", deps);
    return;
  }
  escaped.add(session.id);
  await sendKeys(target, planLimitKeys(surface) ?? []);
  record(card, session, { action: "limit_escape", result: "sent" });
  scheduleAfterReset(card, session, text, "fresh", deps);
}
