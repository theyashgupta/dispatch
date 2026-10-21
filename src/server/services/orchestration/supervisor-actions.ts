import fsp from "node:fs/promises";
import path from "node:path";
import { DEFAULT_BOARD_KEY } from "../../../shared/board-key.js";
import { isHiddenCard } from "../../../shared/hidden-card.js";
import type { Card, Session } from "../../../shared/types.js";
import { boardRepository as store } from "../../store/board-repository.js";
import {
  capturePane,
  paneAtPrompt,
  paneTerminal,
  sendKeys,
  sessionEnvHas,
} from "../../adapters/tmux.js";
import { ENGINE_FILE } from "../domain/loop-progress.js";
import {
  declineKeys,
  type SupervisorAction,
} from "../domain/supervisor-plan.js";
import { withCardLock } from "./card-lock.js";
import { endJob, type EndJobTools } from "./end-job.js";
import { refreshLoopProgress } from "./loop-progress-reader.js";
import { memoryCheck } from "./memory-governor.js";
import { resumeSession } from "./resume-session.js";
import { runClaude, type RunClaudeOutcome } from "./run-claude.js";
import { SHELL_SESSION_ENV } from "./steps.js";
import { sendConfirmed, waitFor, type SendResult } from "./supervisor-send.js";
import {
  orchestratorResumePromptText,
  runHandoff,
} from "./supervisor-handoff.js";
import { answerLimit, escapeLimit, moveOrWait } from "./supervisor-limit.js";
import {
  continueText,
  markNeedsInput,
  orchestratorOf,
  record,
  rootOf,
} from "./supervisor-record.js";

export interface ActionDeps extends EndJobTools {
  resume: (cardId: string) => Promise<void>;
  relaunch: (cardId: string) => Promise<RunClaudeOutcome>;
  shellRoot: (name: string) => Promise<boolean>;
  claudeUpMs: number;
  send?: typeof sendConfirmed;
}

export const actionTools: ActionDeps = {
  resume: resumeSession,
  relaunch: runClaude,
  atShellPrompt: (target) => paneAtPrompt(target).catch(() => false),
  shellRoot: (name) =>
    sessionEnvHas(`=${name}`, SHELL_SESSION_ENV).catch(() => false),
  claudeUpMs: 60_000,
  paneTerminal,
  kill: (pid, signal) => process.kill(pid, signal),
  grace: { hangupMs: 10_000, killMs: 5_000, pollMs: 500 },
};
const POLL_MS = 500;

/**
 * Decline a dangerous delete or a held peer message by moving the cursor to the decline row.
 *
 * @remarks Enter is pressed only after a fresh capture shows the cursor on that row, so a menu
 * that moved meanwhile never gets an accept.
 */
async function answerPrompt(
  card: Card,
  session: Session,
  promptKind: "dangerous_delete" | "peer_message",
  evidence: string,
): Promise<void> {
  const target = `=${session.tmuxSession}:`;
  const row = promptKind === "dangerous_delete" ? "No" : "Deny";
  const keys = declineKeys(await capturePane(target), promptKind);
  let result = "no_decline_row";
  if (keys !== null) {
    for (const key of keys) await sendKeys(target, [key]);
    const confirmed = declineKeys(await capturePane(target), promptKind);
    if (confirmed !== null && confirmed.length === 0) {
      await sendKeys(target, ["Enter"]);
      result = "declined";
    } else {
      result = "cursor_not_on_decline_row";
    }
  }
  record(card, session, {
    action: "answer_prompt",
    promptKind,
    row,
    result,
    evidence,
  });
}

async function closeLoop(card: Card, session: Session): Promise<void> {
  const root = rootOf(card, session);
  const engine = path.join(root, ENGINE_FILE);
  let result = "closed";
  if (root === "") result = "failed: no session root";
  else {
    try {
      await fsp.rename(engine, `${engine}.done`);
    } catch (err) {
      result = `failed: ${(err as NodeJS.ErrnoException).code ?? "error"}`;
    }
  }
  record(card, session, { action: "close_loop", file: engine, result });
  await refreshLoopProgress(card.id);
}

/**
 * The reason a resume must not act on a card, or null when it may.
 *
 * @remarks A hidden orchestrator card resumes only while its orchestrator runs. The memory check
 * applies only where a claude launch follows, so `resume` skips it on the lost-session path.
 */
function resumeBlocked(card: Card, withMemory = true): string | null {
  if (isHiddenCard(card) && orchestratorOf(card)?.state !== "running")
    return "the orchestrator is not running";
  if (!withMemory) return null;
  const memory = memoryCheck(card.boardKey ?? DEFAULT_BOARD_KEY);
  return memory.ok ? null : memory.reason;
}

/**
 * Bring claude back in a lost or shell-prompt session, then send the resume prompt.
 *
 * @remarks A pane whose shell owns the foreground is relaunched with `runClaude`, since the resume
 * saga reattaches a live tmux session without starting claude. The prompt is typed only after
 * claude takes the foreground, so it never reaches the login shell. Resolves the send result, or
 * null when the resume skipped or failed before the prompt send.
 */
async function resume(
  card: Card,
  session: Session,
  deps: ActionDeps,
): Promise<SendResult | null> {
  if (store.isStarting(card.id)) {
    record(card, session, {
      action: "resume",
      result: "skipped",
      reason: "a start is in flight",
    });
    return null;
  }
  const hidden = resumeBlocked(card, false);
  if (hidden !== null) {
    record(card, session, {
      action: "resume",
      result: "skipped",
      reason: hidden,
    });
    return null;
  }
  const owner = orchestratorOf(card);
  const failed = async (why: string) => {
    await markNeedsInput(card, session, "resume_failed", `resume: ${why}`);
    return null;
  };
  if (
    session.tmuxSession !== undefined &&
    (await deps.atShellPrompt(`=${session.tmuxSession}:`))
  ) {
    const blocked = resumeBlocked(card);
    if (blocked !== null) return failed(blocked);
    const outcome = await deps.relaunch(card.id);
    if (outcome !== "launched") return failed(`run claude ${outcome}`);
  } else {
    await deps.resume(card.id);
  }
  const live = store.getCard(card.id);
  const resumed = live?.sessions?.find((s) => s.id === session.id);
  if (!live || !resumed?.tmuxSession) {
    return failed(live?.resumeError ?? "no session");
  }
  const target = `=${resumed.tmuxSession}:`;
  const up = await waitFor(
    async () => !(await deps.atShellPrompt(target)),
    deps.claudeUpMs,
    POLL_MS,
  );
  if (!up) return failed("claude did not start");
  const result = await (deps.send ?? sendConfirmed)(
    live,
    resumed,
    owner
      ? orchestratorResumePromptText(
          owner.id,
          live.boardKey ?? DEFAULT_BOARD_KEY,
        )
      : continueText(live, resumed, "resume"),
    "resume",
  );
  record(card, session, { action: "resume", result });
  return result;
}

function frozenStale(live: Card | undefined, session: Session): string | null {
  if (!live) return "the card is gone";
  const current = live.sessions?.find((s) => s.id === session.id);
  if (live.activeSessionId !== session.id || !current)
    return "the session is not the active one";
  if (current.tmuxSession !== session.tmuxSession)
    return "the tmux session changed";
  if (live.paused) return "the card is paused";
  if (store.isStarting(live.id)) return "a start is in flight";
  return session.tmuxSession === undefined ? "no tmux session" : null;
}

/**
 * Stop a frozen claude in its tmux window, then relaunch it with resume and type the loop prompt once.
 *
 * @remarks The stop reuses `endJob` (hangup, then kill of the foreground group, never the shell
 * group) because a typed `/exit` would only queue in the frozen box. Every check runs before the
 * first signal.
 */
async function relaunchFrozen(
  card: Card,
  session: Session,
  frozenSince: string,
  evidence: string,
  deps: ActionDeps,
): Promise<void> {
  const event = { action: "relaunch_frozen", frozenSince, evidence };
  const fail = async (why: string) => {
    record(card, session, {
      ...event,
      result: "failed",
      reason: why,
    });
    await markNeedsInput(card, session, "resume_failed", `relaunch: ${why}`);
  };
  const live = store.getCard(card.id);
  const name = session.tmuxSession;
  const stale = frozenStale(live, session);
  if (live === undefined || name === undefined || stale !== null) {
    record(card, session, { ...event, result: "skipped", reason: stale });
    return;
  }
  const blocked = resumeBlocked(live);
  if (blocked !== null) return fail(blocked);
  if (!(await deps.shellRoot(name))) return fail("no shell root");
  const target = `=${name}:`;
  const ended = await withCardLock(card.id, () => endJob(target, deps));
  if (ended === "busy") {
    record(card, session, {
      ...event,
      result: "skipped",
      reason: "card busy",
    });
    return;
  }
  if (!(await deps.atShellPrompt(target))) return fail("claude did not exit");
  record(card, session, { ...event, result: "stopped" });
  const sent = await resume(card, session, deps);
  if (sent !== null)
    await store.recordSessionRelaunch(
      card.id,
      `relaunched with resume after a freeze since ${frozenSince}`,
    );
}

/**
 * Run the planned actions of one state change in order and record each as one event.
 *
 * @remarks Runs inside the session's sampling turn, so a slow send holds later samples of that
 * session instead of letting them plan a second time.
 */
export async function runActions(
  card: Card,
  session: Session,
  actions: SupervisorAction[],
  evidence: string,
  deps: ActionDeps = actionTools,
): Promise<void> {
  for (const action of actions) {
    switch (action.kind) {
      case "continue": {
        const result = await sendConfirmed(
          card,
          session,
          continueText(card, session, action.duty),
          action.duty,
        );
        record(card, session, {
          action: "continue",
          duty: action.duty,
          result,
          evidence,
        });
        break;
      }
      case "needs_input":
        await markNeedsInput(card, session, action.reason, evidence);
        break;
      case "answer_prompt":
        await answerPrompt(card, session, action.promptKind, evidence);
        break;
      case "close_loop":
        await closeLoop(card, session);
        break;
      case "resume":
        await resume(card, session, deps);
        break;
      case "answer_limit":
        await answerLimit(card, session);
        break;
      case "escape_limit":
        await escapeLimit(card, session, evidence);
        break;
      case "limit_move":
        await moveOrWait(
          card,
          session,
          `${evidence}\n${await capturePane(`=${session.tmuxSession}:`).catch(() => "")}`,
        );
        break;
      case "handoff":
        await runHandoff(card, session);
        break;
      case "relaunch_frozen":
        await relaunchFrozen(card, session, action.frozenSince, evidence, deps);
        break;
    }
  }
}
