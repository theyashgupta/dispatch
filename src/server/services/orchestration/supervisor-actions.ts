import fsp from "node:fs/promises";
import path from "node:path";
import type { Card, Session } from "../../../shared/types.js";
import { boardRepository as store } from "../../store/board-repository.js";
import { capturePane, paneAtPrompt, sendKeys } from "../../adapters/tmux.js";
import { ENGINE_FILE } from "../domain/loop-progress.js";
import {
  declineKeys,
  type SupervisorAction,
} from "../domain/supervisor-plan.js";
import { resumeSession } from "./resume-session.js";
import { runClaude, type RunClaudeOutcome } from "./run-claude.js";
import { sendConfirmed, waitFor } from "./supervisor-send.js";
import { runHandoff } from "./supervisor-handoff.js";
import { answerLimit, escapeLimit } from "./supervisor-limit.js";
import {
  continueText,
  markNeedsInput,
  record,
  rootOf,
} from "./supervisor-record.js";

export interface ActionDeps {
  resume: (cardId: string) => Promise<void>;
  relaunch: (cardId: string) => Promise<RunClaudeOutcome>;
  atShellPrompt: (target: string) => Promise<boolean>;
  claudeUpMs: number;
}

const DEFAULT_DEPS: ActionDeps = {
  resume: resumeSession,
  relaunch: runClaude,
  atShellPrompt: (target) => paneAtPrompt(target).catch(() => false),
  claudeUpMs: 60_000,
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
}

/**
 * Bring claude back in a lost or shell-prompt session, then send the resume prompt.
 *
 * @remarks A pane whose shell owns the foreground is relaunched with `runClaude`, since the resume
 * saga reattaches a live tmux session without starting claude. The prompt is typed only after
 * claude takes the foreground, so it never reaches the login shell.
 */
async function resume(
  card: Card,
  session: Session,
  deps: ActionDeps,
): Promise<void> {
  if (store.isStarting(card.id)) {
    record(card, session, {
      action: "resume",
      result: "skipped",
      reason: "a start is in flight",
    });
    return;
  }
  const failed = (why: string) =>
    markNeedsInput(card, session, "resume_failed", `resume: ${why}`);
  if (
    session.tmuxSession !== undefined &&
    (await deps.atShellPrompt(`=${session.tmuxSession}:`))
  ) {
    const outcome = await deps.relaunch(card.id);
    if (outcome !== "launched") return failed(`run claude ${outcome}`);
  } else {
    await deps.resume(card.id);
  }
  const live = store.getCard(card.id);
  const resumed = live?.sessions?.find((s) => s.id === session.id);
  if (!live || !resumed?.tmuxSession) return failed("no session");
  const target = `=${resumed.tmuxSession}:`;
  const up = await waitFor(
    async () => !(await deps.atShellPrompt(target)),
    deps.claudeUpMs,
    POLL_MS,
  );
  if (!up) return failed("claude did not start");
  const result = await sendConfirmed(
    live,
    resumed,
    continueText(live, resumed, "resume"),
    "resume",
  );
  record(card, session, { action: "resume", result });
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
  deps: ActionDeps = DEFAULT_DEPS,
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
        await escapeLimit(card, session);
        break;
      case "handoff":
        await runHandoff(card, session);
        break;
    }
  }
}
