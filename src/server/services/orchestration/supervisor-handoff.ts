import path from "node:path";
import type { BoardPolicy, Card, Session } from "../../../shared/types.js";
import { boardRepository as store } from "../../store/board-repository.js";
import { sleep } from "../../adapters/exec.js";
import { capturePane, sendKeys, sendLiteral } from "../../adapters/tmux.js";
import { newestJsonl, readTranscriptTail } from "../../adapters/transcript.js";
import {
  ENGINE_FILE,
  loopFilePath,
  parseEngineFile,
} from "../domain/loop-progress.js";
import { paneBusy, paneReady } from "../domain/supervisor-state.js";
import { readLoopFile } from "./loop-progress-reader.js";
import { giveUp, record, rootOf } from "./supervisor-record.js";
import { sendConfirmed, SEND_TIMING, waitFor } from "./supervisor-send.js";
import { sessionTranscriptPath } from "./supervisor-transcript.js";

export interface HandoffTiming {
  readyMs: number;
  engineMs: number;
  cancelWindowMs: number;
  pollMs: number;
}

const HANDOFF_TIMING: HandoffTiming = {
  readyMs: 60_000,
  engineMs: 80_000,
  cancelWindowMs: 5 * 60_000,
  pollMs: 500,
};
const REQUEST_TITLE = "Context handoff request";
const REQUEST_SIGN =
  /Context handoff request|context-refresh request|-handoff(-hard)?\.md/;

interface Resumed {
  at: number;
  transcript: string;
}

const crossings = new Map<string, boolean>();
const resumed = new Map<string, Resumed>();

/** The handoff request a loop receives at the context threshold, restating the orchestrator's request file. */
export function handoffRequestText(
  slug: string,
  root: string,
  hard: boolean,
): string {
  const engine = path.join(root, ENGINE_FILE);
  return [
    hard
      ? `${REQUEST_TITLE} (hard limit). Your context is at the hard limit. Hand off now: do not start or wait for more work. Record where you are, then:`
      : `${REQUEST_TITLE}. Your context is high. Do not interrupt in-flight work. Let running background agents and shells finish and record the current phase gate first. Then, at that safe point:`,
    `1. Invoke the session-handoff skill. Write its resume prompt to ${path.join(root, loopFilePath(slug, "resume.md"))}. The prompt must tell the next session to write its own session id into the session_id line of ${engine} before any phase work.`,
    `2. Update ${path.join(root, loopFilePath(slug, "progress.md"))} with the exact current unit and phase.`,
    `3. As the very last action, set the session_id line in ${engine} to handoff-pending.`,
    `4. Print the line HANDOFF_READY ${slug} and end your turn without starting new work.`,
    "The resume prompt must restate the marker rule (end a stop for a human with its own line DISPATCH_STATUS: NEEDS_INPUT - <reason>, and the finished loop with DISPATCH_STATUS: DONE - <summary>) and the handoff rule (hand off only when asked, or when the status line passes 80 percent).",
  ].join("\n");
}

/** The first prompt of the fresh session after a handoff. */
export function resumePromptText(slug: string, root: string): string {
  const engine = path.join(root, ENGINE_FILE);
  return [
    `Resume the ${slug} loop. First write your own session id (the basename of your newest transcript file) into the session_id line of ${engine}.`,
    `Then read ${path.join(root, loopFilePath(slug, "resume.md"))} and follow it.`,
    "When you stop to wait for a human, end that message with its own line DISPATCH_STATUS: NEEDS_INPUT - <reason>; when the loop is finished, end with DISPATCH_STATUS: DONE - <summary>.",
    "Hand off context only when asked, or when the status line passes 80 percent; never on your own estimate.",
  ].join(" ");
}

const CANCEL_LINE =
  "Ignore the context handoff request above: the handoff is already done and this is the fresh session. Continue the loop.";

/**
 * Send the handoff request once per threshold crossing, and the hard request once above the hard threshold.
 *
 * @remarks The crossing re-arms when the meter falls under `handoffPercent`, as after a clear. A
 * session whose engine already says `handoff-pending` gets no request.
 */
export async function checkHandoffThreshold(
  card: Card,
  session: Session,
  policy: Pick<BoardPolicy, "handoffPercent" | "handoffHardPercent">,
): Promise<void> {
  const progress = card.loopProgress;
  const engine = progress?.engine;
  const percent = session.contextPercent;
  if (!progress || !engine?.active || engine.closed || percent == null) return;
  if (percent < policy.handoffPercent) {
    crossings.delete(session.id);
    return;
  }
  if (engine.handoffPending) return;
  const hardSent = crossings.get(session.id) ?? false;
  const hard = percent >= policy.handoffHardPercent && !hardSent;
  if (crossings.has(session.id) && !hard) return;
  crossings.set(session.id, hardSent || hard);
  const result = await sendConfirmed(
    card,
    session,
    handoffRequestText(progress.slug, rootOf(card, session), hard),
    hard ? "handoff-hard" : "handoff",
  );
  record(card, session, {
    action: "handoff_request",
    hard,
    contextPercent: percent,
    result,
  });
}

/**
 * Send one cancel line when the fresh session receives a handoff request within five minutes of the resume.
 */
export async function checkHandoffCancel(
  card: Card,
  session: Session,
  now: number,
  timing: HandoffTiming = HANDOFF_TIMING,
): Promise<void> {
  const after = resumed.get(session.id);
  if (!after) return;
  if (now - after.at > timing.cancelWindowMs) {
    resumed.delete(session.id);
    return;
  }
  const tail = await readTranscriptTail(after.transcript);
  if (!tail?.userTexts.some((text) => REQUEST_SIGN.test(text))) return;
  resumed.delete(session.id);
  const result = await sendConfirmed(
    card,
    session,
    CANCEL_LINE,
    "handoff-cancel",
    SEND_TIMING,
    () => Promise.resolve(after.transcript),
  );
  record(card, session, { action: "handoff_cancel", result });
}

async function engineSessionId(root: string): Promise<string | null> {
  const text = await readLoopFile(root, ENGINE_FILE);
  return text === null
    ? null
    : (parseEngineFile(text, false).engine?.sessionId ?? null);
}

/**
 * Start a fresh conversation in the same pane and resume the loop in it.
 *
 * @remarks `/clear` starts a new transcript file, so the resume prompt is confirmed in the newest
 * transcript of the same project folder, and the engine must name that file within 80 s. Any
 * unconfirmed step leaves the session at `needs_input`.
 */
export async function runFreshSession(
  card: Card,
  session: Session,
  timing: HandoffTiming = HANDOFF_TIMING,
): Promise<boolean> {
  const slug = card.loopProgress?.slug;
  const root = rootOf(card, session);
  const target = `=${session.tmuxSession}:`;
  const old = await sessionTranscriptPath(card, session);
  const fail = async (step: string): Promise<false> => {
    await giveUp(
      card,
      session,
      { action: "handoff", result: "unconfirmed", step },
      `handoff: ${step} not confirmed`,
    );
    return false;
  };
  if (!slug || old === null) return fail("transcript");
  const dir = path.dirname(old);
  const newest = () => newestJsonl(dir);
  const quietAndReady = async () => {
    const pane = await capturePane(target).catch(() => "");
    return paneReady(pane) && !paneBusy(pane);
  };

  if (!(await waitFor(quietAndReady, timing.readyMs, timing.pollMs)))
    return fail("clear");
  await sendKeys(target, ["C-u"]);
  await sendLiteral(target, "/clear");
  await sleep(SEND_TIMING.settleMs);
  if (!(await quietAndReady())) return fail("clear");
  await sendKeys(target, ["Enter"]);
  if (!(await waitFor(quietAndReady, timing.readyMs, timing.pollMs)))
    return fail("clear");

  const sent = await sendConfirmed(
    card,
    session,
    resumePromptText(slug, root),
    "resume",
    SEND_TIMING,
    newest,
  );
  const fresh = await newestJsonl(dir);
  if (sent !== "confirmed" || fresh === null || fresh === old)
    return fail("resume prompt");
  const id = path.basename(fresh, ".jsonl");
  const named = await waitFor(
    async () => (await engineSessionId(root)) === id,
    timing.engineMs,
    timing.pollMs,
  );
  if (!named) return fail("engine session id");
  await store.setTranscriptPath(card.id, session.id, fresh);
  resumed.set(session.id, { at: Date.now(), transcript: fresh });
  crossings.delete(session.id);
  record(card, session, {
    action: "handoff",
    result: "confirmed",
    sessionId: id,
  });
  return true;
}

/** Hand off at `handoff_ready`: wait for the turn to end, then run the fresh session steps. */
export async function runHandoff(
  card: Card,
  session: Session,
  timing: HandoffTiming = HANDOFF_TIMING,
): Promise<boolean> {
  const target = `=${session.tmuxSession}:`;
  const quiet = await waitFor(
    async () => !paneBusy(await capturePane(target).catch(() => "")),
    timing.readyMs,
    timing.pollMs,
  );
  if (!quiet) {
    await giveUp(
      card,
      session,
      { action: "handoff", result: "unconfirmed", step: "busy" },
      "handoff: still busy",
    );
    return false;
  }
  return runFreshSession(card, session, timing);
}
