import {
  DEFAULT_CLAUDE_ACCOUNT_ID,
  type Card,
  type Session,
} from "../../../shared/types.js";
import { DEFAULT_BOARD_KEY } from "../../../shared/board-key.js";
import { boardRepository as store } from "../../store/board-repository.js";
import { sleep } from "../../adapters/exec.js";
import { capturePane, sendKeys } from "../../adapters/tmux.js";
import {
  CREDITS_OPTION,
  limitChoice,
  planLimitKeys,
} from "../domain/limit-surface.js";
import { parseResetAt } from "../domain/supervisor-plan.js";
import { limitSurfaceOf } from "../domain/supervisor-state.js";
import { getUsage } from "./claude-usage.js";
import { runFreshSession } from "./supervisor-handoff.js";
import {
  continueText,
  giveUp,
  markNeedsInput,
  record,
} from "./supervisor-record.js";
import { sendConfirmed } from "./supervisor-send.js";

export interface LimitDeps {
  now: () => number;
  schedule: (run: () => void, ms: number) => void;
  usageResetAt: (session: Session) => number | null;
  cursorWaitMs: number;
}

const RESET_GRACE_MS = 2 * 60_000;
const MAX_WAIT_MS = 2 ** 31 - 1;
const FALLBACK_MS = 5 * 60 * 60_000;

/** The five hour window reset of the session's account from the usage poll, if known. */
function usageResetAt(session: Session): number | null {
  const usage = getUsage(session.claudeAccountId ?? DEFAULT_CLAUDE_ACCOUNT_ID);
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

const scheduled = new Set<string>();
const escaped = new Set<string>();

/**
 * The card and session a reset timer may still act on, or null.
 *
 * @remarks The timer fires hours after it was set, so it re-checks that the session is live, that
 * its board still runs the supervisor with the `wait` policy, and that no stop reason was set since.
 */
function liveSession(cardId: string, sessionId: string) {
  const card = store.getCard(cardId);
  const session = card?.sessions?.find((s) => s.id === sessionId);
  const policy = store.getBoard(card?.boardKey ?? DEFAULT_BOARD_KEY)?.policy;
  return card &&
    session?.tmuxSession &&
    session.stateReason === undefined &&
    policy?.supervisor === "on" &&
    policy.usageLimit === "wait"
    ? { card, session }
    : null;
}

/**
 * Schedule the one wait-policy action for after the limit resets.
 *
 * @remarks The reset time comes from the pane, else the usage poll, else five hours after now;
 * the action runs two minutes after it. One timer per session.
 */
function scheduleAfterReset(
  card: Card,
  session: Session,
  pane: string,
  mode: "continue" | "fresh",
  deps: LimitDeps,
): void {
  if (scheduled.has(session.id)) return;
  const now = deps.now();
  const fromPane = parseResetAt(pane, now);
  const fromUsage = fromPane === null ? deps.usageResetAt(session) : null;
  const resetAt = fromPane ?? fromUsage ?? now + FALLBACK_MS;
  const source =
    fromPane !== null ? "pane" : fromUsage !== null ? "usage" : "fallback";
  const due = resetAt + RESET_GRACE_MS;
  scheduled.add(session.id);
  record(card, session, {
    action: "limit_wait",
    mode,
    source,
    until: new Date(due).toISOString(),
  });
  deps.schedule(
    () => {
      scheduled.delete(session.id);
      escaped.delete(session.id);
      const live = liveSession(card.id, session.id);
      if (live === null) return;
      if (mode === "fresh" && !live.card.loopProgress?.engine?.handoffPending)
        return;
      void (async () => {
        if (mode === "fresh") {
          await runFreshSession(live.card, live.session);
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
  const policy =
    store.getBoard(card.boardKey ?? DEFAULT_BOARD_KEY)?.policy.usageLimit ??
    "wait";
  if (policy === "stop") {
    await markNeedsInput(card, session, "usage_stop", "limit: policy stop");
    return;
  }
  scheduleAfterReset(
    card,
    session,
    pane,
    card.loopProgress?.engine?.handoffPending ? "fresh" : "continue",
    deps,
  );
}

/**
 * Leave the auto continue surface of a loop that waits for a handoff, and start it fresh after the reset.
 *
 * @remarks Escape is sent once per surface; a resumed old conversation would spend the fresh
 * context the handoff prepared.
 */
export async function escapeLimit(
  card: Card,
  session: Session,
  deps: LimitDeps = DEFAULT_DEPS,
): Promise<void> {
  if (escaped.has(session.id)) return;
  const target = `=${session.tmuxSession}:`;
  const pane = await capturePane(target);
  const surface = limitSurfaceOf(pane);
  if (surface?.kind !== "a") return;
  escaped.add(session.id);
  await sendKeys(target, planLimitKeys(surface) ?? []);
  record(card, session, { action: "limit_escape", result: "sent" });
  scheduleAfterReset(card, session, pane, "fresh", deps);
}
