import { DEFAULT_CLAUDE_ACCOUNT_ID } from "../../../shared/types.js";
import { boardRepository as store } from "../../store/board-repository.js";
import { preSeedTrust } from "../../adapters/claude-trust.js";
import { sleep } from "../../adapters/exec.js";
import {
  capturePane,
  hasSession,
  paneAtPrompt,
  sendKeys,
  sendLiteral,
  sessionEnvHas,
  setSessionEnv,
} from "../../adapters/tmux.js";
import { accountEnvLine } from "../domain/claude-launch.js";
import {
  CREDITS_OPTION,
  limitChoice,
  parseLimitSurface,
  planLimitKeys,
  type LimitSurface,
} from "../domain/limit-surface.js";
import { readRegistry, resolveLaunchAccount } from "./claude-accounts.js";
import { withCardLock } from "./run-claude.js";
import { forgetTurnState, paneTurnState, turnStateOf } from "./session-turn.js";
import {
  awaitReplReady,
  awaitShellPrompt,
  buildLaunch,
  existingHooks,
  READY,
  RESUME_MISSING,
  SHELL_SESSION_ENV,
  StartStepError,
  typeAccountEnvLine,
  typeLaunchLine,
} from "./steps.js";

export type MoveCause = "switch" | "turn end" | "session action";

export type SessionMoveOutcome =
  | "moved"
  | "busy"
  | "same"
  | "no-session"
  | "legacy"
  | "account"
  | "limit-unknown";

const EXIT_TIMEOUT_MS = 15_000;
const LIMIT_CLEAR_MS = 10_000;
const LIMIT_POLL_MS = 200;
const FOOTER_LINES = 5;

/**
 * Poll a pane until `done` holds for a capture; `null` when the wait runs out or a capture fails.
 *
 * @remarks The 10 s bound is overridden by `DISPATCH_LIMIT_CLEAR_MS` so tests need not wait it out.
 */
async function awaitPane(
  paneTarget: string,
  done: (pane: string) => boolean,
): Promise<string | null> {
  const deadline =
    Date.now() +
    (Number(process.env.DISPATCH_LIMIT_CLEAR_MS) || LIMIT_CLEAR_MS);
  for (;;) {
    const pane = await capturePane(paneTarget).catch(() => null);
    if (pane === null) return null;
    if (done(pane)) return pane;
    if (Date.now() >= deadline) return null;
    await sleep(LIMIT_POLL_MS);
  }
}

/**
 * Return the last non-blank lines of a pane, where Claude draws its input footer.
 *
 * @remarks Text higher up can be stale scrollback, so readiness is read from the footer only.
 */
function footer(pane: string): string {
  return pane
    .split("\n")
    .filter((line) => line.trim() !== "")
    .slice(-FOOTER_LINES)
    .join("\n");
}

/**
 * Name an account for an activity row: "Default" for the home login, else its email.
 *
 * @remarks Falls back to the id for an account the registry no longer lists. Never reads a path
 * or a token.
 */
async function accountLabel(id: string): Promise<string> {
  if (id === DEFAULT_CLAUDE_ACCOUNT_ID) return "Default";
  const record = (await readRegistry()).find((a) => a.id === id);
  return record?.email || id;
}

/**
 * Send the keys that answer one limit surface, or return false when none is safe.
 *
 * @remarks Enter goes only after a fresh capture shows the pointer on the stop or wait row, so a
 * dropped arrow key can never select the row under the old cursor.
 */
async function answerLimit(
  paneTarget: string,
  surface: LimitSurface,
): Promise<boolean> {
  const keys = planLimitKeys(surface);
  if (keys === null) return false;
  if (surface.kind === "a") {
    await sendKeys(paneTarget, keys);
    return true;
  }
  const chosen = surface.options[limitChoice(surface.options) ?? -1];
  if (chosen === undefined || CREDITS_OPTION.test(chosen)) return false;
  const arrows = keys.slice(0, -1);
  if (arrows.length > 0) await sendKeys(paneTarget, arrows);
  const onChoice = await awaitPane(paneTarget, (pane) => {
    const now = parseLimitSurface(pane);
    return now?.kind === "b" && now.options[now.cursor] === chosen;
  });
  if (onChoice === null) return false;
  await sendKeys(paneTarget, ["Enter"]);
  return true;
}

/**
 * Leave the limit surface a pane shows, returning the pane once Claude waits for input or `null`.
 *
 * @remarks Only surface (a) after the menu, as the wait option leaves it, gets a second round.
 */
async function clearLimitSurface(
  paneTarget: string,
  pane: string,
): Promise<string | null> {
  let shown = pane;
  let surface = parseLimitSurface(shown);
  for (let round = 0; surface !== null; round++) {
    if (round > 0 && surface.kind !== "a") return null;
    if (!(await answerLimit(paneTarget, surface))) return null;
    const from = surface.kind;
    const next = await awaitPane(paneTarget, (p) => {
      const now = parseLimitSurface(p);
      return now === null ? READY.test(p) : now.kind !== from;
    });
    if (next === null) return null;
    shown = next;
    surface = parseLimitSurface(next);
  }
  return shown;
}

/**
 * Move one live session of a card to another Claude account and resume the same conversation.
 *
 * @remarks Claude is stopped only at a safe point: idle with its input footer showing, never while
 * the pane shows `esc to interrupt`, and a limit surface is first left with keys that never select
 * a paid option. Every refusal returns before the first change, except the limit keys and a
 * `/exit` that does not reach the shell within 15 s. A stale session moved to its own account is
 * the restart; recording the account clears the stale mark.
 * @see docs/ARCHITECTURE.md#claude-accounts
 */
export async function moveSessionAccount(
  cardId: string,
  accountId: string,
  sessionId?: string,
  cause: MoveCause = "session action",
): Promise<SessionMoveOutcome> {
  const card = store.getCard(cardId);
  const targetId = sessionId ?? card?.activeSessionId;
  const session = card?.sessions?.find((s) => s.id === targetId);
  const tmuxSession = session?.tmuxSession;
  if (!card || !session || !tmuxSession) return "no-session";
  return withCardLock(cardId, async () => {
    const sessionTarget = `=${tmuxSession}`;
    const paneTarget = `=${tmuxSession}:`;
    if (!(await hasSession(sessionTarget))) return "no-session";
    if (!(await sessionEnvHas(sessionTarget, SHELL_SESSION_ENV)))
      return "legacy";
    if (
      (session.claudeAccountId ?? DEFAULT_CLAUDE_ACCOUNT_ID) === accountId &&
      session.claudeAccountStale !== true
    ) {
      return "same";
    }
    const account = await resolveLaunchAccount(accountId).catch(() => null);
    if (account == null) return "account";
    const envLine = accountEnvLine(account.configDir);

    if (!(await paneAtPrompt(paneTarget))) {
      let pane = await capturePane(paneTarget);
      let turn = turnStateOf(card.id, session.id, pane);
      if (turn === "limit") {
        const cleared = await clearLimitSurface(paneTarget, pane);
        if (cleared === null) return "limit-unknown";
        pane = cleared;
        turn = paneTurnState(cleared);
      }
      if (turn !== "idle" || !READY.test(footer(pane))) return "busy";
      await sendLiteral(paneTarget, "/exit");
      await sendKeys(paneTarget, ["Enter"]);
      try {
        await awaitShellPrompt(tmuxSession, EXIT_TIMEOUT_MS);
      } catch {
        return "busy";
      }
    }

    await setSessionEnv(sessionTarget, "CLAUDE_CONFIG_DIR", account.configDir);
    await typeAccountEnvLine(tmuxSession, envLine);
    if (session.workspacePath) {
      await preSeedTrust(session.workspacePath, account.configDir);
    }
    const from = await accountLabel(
      session.claudeAccountId ?? DEFAULT_CLAUDE_ACCOUNT_ID,
    );
    const to = await accountLabel(account.id);
    await store.setSessionAccount(card.id, session.id, account.id);
    await store.recordAccountEvent(
      "account_moved",
      `${from} to ${to}, ${cause}`,
      card.id,
    );

    const attempted = session.claudeSessionId;
    const { argv } = await buildLaunch(
      account,
      attempted ? ["--resume", attempted] : [],
      existingHooks({ ...card, hookToken: session.hookToken }),
    );
    await typeLaunchLine(tmuxSession, argv);
    forgetTurnState(card.id, session.id);
    try {
      await awaitReplReady(tmuxSession);
    } catch (err) {
      if (
        attempted !== undefined &&
        err instanceof StartStepError &&
        RESUME_MISSING.test(err.stderr)
      ) {
        await store.markClaudeSessionMissing(card.id, session.id, attempted);
      } else {
        console.warn(
          `[account-move] claude did not reach READY for card ${card.id}`,
        );
      }
    }
    return "moved";
  });
}
