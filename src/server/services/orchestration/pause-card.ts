import { ALL_BOARDS } from "../../../shared/board-key.js";
import { isHiddenCard } from "../../../shared/hidden-card.js";
import type {
  ActivityEvent,
  Card,
  PausedBy,
  Session,
} from "../../../shared/types.js";
import { sleep } from "../../adapters/exec.js";
import {
  readElapsed,
  signalSafe,
  signalTree,
  type TreeSignal,
} from "../../adapters/process-tree.js";
import {
  paneTerminal,
  panePidsBySession,
  sendKeys,
  sendLiteral,
  sessionEnvHas,
} from "../../adapters/tmux.js";
import { boardRepository as store } from "../../store/board-repository.js";
import { ConflictError, NotFoundError } from "../domain/errors.js";
import { withCardLock } from "./card-lock.js";
import { SHELL_SESSION_ENV } from "./steps.js";
import { record } from "./supervisor-record.js";

export const pauseTools: {
  panePids: typeof panePidsBySession;
  signalTree: typeof signalTree;
  paneTerminal: typeof paneTerminal;
  readElapsed: typeof readElapsed;
  sendKeys: typeof sendKeys;
  sendLiteral: typeof sendLiteral;
  sessionEnvHas: typeof sessionEnvHas;
  sleep: (ms: number) => Promise<void>;
  kill: (pid: number, signal: TreeSignal | "SIGHUP") => void;
} = {
  panePids: panePidsBySession,
  signalTree,
  paneTerminal,
  readElapsed,
  sendKeys,
  sendLiteral,
  sessionEnvHas,
  sleep,
  kill: (pid, signal) => process.kill(pid, signal),
};

const NO_LIVE_SESSION = "no live session";
const OTHER_OWNER = "a command typed while paused owns the terminal";
const POLL_MS = 100;
const POLL_LIMIT = 10;
const HANGUP_SLACK_SECONDS = 2;

type LiveSession = Session & { tmuxSession: string };

/** The card's active session when it has a tmux session, else undefined. */
export function activeSession(card: Card): LiveSession | undefined {
  const session = card.sessions?.find((s) => s.id === card.activeSessionId);
  return session?.tmuxSession ? (session as LiveSession) : undefined;
}

function pausable(card: Card): { session: LiveSession } | { reason: string } {
  if (isHiddenCard(card)) return { reason: "orchestrator session" };
  if (card.source !== "group" && card.launch === undefined)
    return { reason: "not a loop" };
  if (store.isStarting(card.id)) return { reason: "start in progress" };
  const session = activeSession(card);
  return session ? { session } : { reason: NO_LIVE_SESSION };
}

/** The reason a card cannot be paused, or null when it can. */
export function pauseRefusal(card: Card): string | null {
  const result = pausable(card);
  return "reason" in result ? result.reason : null;
}

function requireCard(cardId: string): Card {
  const card = store.getCard(cardId);
  if (!card) throw new NotFoundError(`unknown card id: ${cardId}`);
  return card;
}

async function panePidsOf(tmuxSession: string): Promise<number[] | undefined> {
  const pids = (await pauseTools.panePids())?.get(tmuxSession);
  return pids && pids.length > 0 ? pids : undefined;
}

/**
 * Continue every process of a tmux session so a kill can run on it.
 *
 * @remarks Stopped processes ignore SIGHUP and SIGTERM until continued. The live tree is
 * continued first, then the stored pids of any card paused in this session, which reaches children
 * that were reparented to pid 1. Never throws: a missing pane list or a failed signal must not
 * block the kill that follows.
 */
export async function continueSession(tmuxSession: string): Promise<void> {
  await continueLive(tmuxSession);
  continueStored(tmuxSession);
}

async function continueLive(tmuxSession: string): Promise<void> {
  try {
    const pids = (await pauseTools.panePids())?.get(tmuxSession);
    if (pids && pids.length > 0) await pauseTools.signalTree(pids, "SIGCONT");
  } catch {
    return;
  }
}

function continueStored(tmuxSession: string): void {
  try {
    for (const card of store.listCards(ALL_BOARDS)) {
      const mark = card.paused;
      const owner = card.sessions?.find((s) => s.id === mark?.sessionId);
      if (mark && owner?.tmuxSession === tmuxSession)
        continueOrphans(mark.pids);
    }
  } catch {
    return;
  }
}

/**
 * SIGCONT each pid of a paused mark whose session ended, so they can exit.
 *
 * @remarks A stopped process outlives its tmux session as an orphan holding memory. Every signal
 * error (ESRCH for an exited pid, EPERM for a reused one) is ignored.
 */
export function continueOrphans(pids: number[]): void {
  for (const pid of pids) {
    if (!signalSafe(pid)) continue;
    try {
      pauseTools.kill(pid, "SIGCONT");
    } catch {
      continue;
    }
  }
}

/**
 * Continue the pids a store write released from a paused mark, then hang up the ones that outlived it.
 *
 * @remarks A continued orphan exits only if a hangup was pending, so a pid that started before the
 * pause gets SIGHUP. A younger pid is a reused pid and is left alone. Never throws: it runs as a
 * store listener.
 */
export async function onPausedPidsReleased(
  event: ActivityEvent,
): Promise<void> {
  const { pausedPids, pausedAt } = event;
  if (!pausedPids) return;
  try {
    continueOrphans(pausedPids);
    const pausedMs = pausedAt ? Date.parse(pausedAt) : NaN;
    if (Number.isNaN(pausedMs)) return;
    const elapsed = await pauseTools.readElapsed(pausedPids);
    if (!elapsed) return;
    const ageSeconds = (Date.now() - pausedMs) / 1000;
    for (const [pid, seconds] of elapsed) {
      if (!signalSafe(pid) || seconds + HANGUP_SLACK_SECONDS < ageSeconds)
        continue;
      try {
        pauseTools.kill(pid, "SIGHUP");
      } catch {
        continue;
      }
    }
  } catch {
    return;
  }
}

function assertPausable(card: Card): LiveSession {
  if (card.paused) throw new ConflictError("already-paused");
  const result = pausable(card);
  if ("reason" in result)
    throw new ConflictError("not-pausable", { reason: result.reason });
  return result.session;
}

/**
 * Stop every process of a loop card's session and mark the card paused.
 *
 * @remarks Runs under the card lock and writes the mark before it signals, so a session that dies
 * mid-pause releases the mark's pids through the store event. A signal that fails or stops
 * nothing removes the mark.
 */
export async function pauseCard(
  cardId: string,
  opts: { by: PausedBy; reason: string },
): Promise<Card> {
  const result = await withCardLock(
    cardId,
    async () => {
      const card = requireCard(cardId);
      const session = assertPausable(card);
      const target = `=${session.tmuxSession}`;
      if (!(await pauseTools.sessionEnvHas(target, SHELL_SESSION_ENV)))
        throw new ConflictError("not-pausable", { reason: "no shell session" });
      const marked = await store.markCardPaused(card.id, session.id, {
        at: new Date().toISOString(),
        by: opts.by,
        sessionId: session.id,
        pids: [],
      });
      if (!marked)
        throw new ConflictError("not-pausable", { reason: NO_LIVE_SESSION });
      const pids = await panePidsOf(session.tmuxSession);
      const signalled = pids
        ? await pauseTools.signalTree(pids, "SIGSTOP")
        : null;
      if (!signalled?.length) {
        await store.clearCardPaused(card.id);
        throw new ConflictError("not-pausable", {
          reason: pids && !signalled ? "process read failed" : NO_LIVE_SESSION,
        });
      }
      await store.setPausedPids(card.id, signalled);
      if (store.getCard(card.id)?.paused?.sessionId !== session.id) {
        continueOrphans(signalled);
        throw new ConflictError("not-pausable", { reason: NO_LIVE_SESSION });
      }
      record(card, session, {
        action: "pause",
        by: opts.by,
        reason: opts.reason,
      });
      return requireCard(card.id);
    },
    { allowPaused: true },
  );
  if (result !== "busy") return result;
  assertPausable(requireCard(cardId));
  throw new ConflictError("busy");
}

type Terminal = { pgid: number; tpgid: number };

async function pollTerminal(
  target: string,
  done: (terminal: Terminal) => boolean,
): Promise<{ terminal: Terminal | null; met: boolean }> {
  let terminal: Terminal | null = null;
  for (let i = 0; i <= POLL_LIMIT; i++) {
    terminal = await Promise.resolve(pauseTools.paneTerminal(target)).catch(
      () => null,
    );
    if (!terminal) break;
    if (done(terminal)) return { terminal, met: true };
    if (i < POLL_LIMIT) await pauseTools.sleep(POLL_MS);
  }
  return { terminal, met: false };
}

/** Refuse an unpause while a process other than the shell or the paused job owns the pane terminal. */
async function assertTerminalFree(
  tmuxSession: string,
  pids: number[],
): Promise<void> {
  const jobPgid = pids[1];
  if (jobPgid === undefined) return;
  const terminal = await Promise.resolve(
    pauseTools.paneTerminal(`=${tmuxSession}:`),
  ).catch(() => null);
  if (
    terminal &&
    terminal.tpgid !== terminal.pgid &&
    terminal.tpgid !== jobPgid
  )
    throw new ConflictError("unpause-incomplete", { reason: OTHER_OWNER });
}

/**
 * Bring claude back to the foreground of a pane when the shell took the terminal.
 *
 * @remarks The job is the first child of the pane shell, `pids[1]` of the mark; with fewer pids it
 * is any non-shell owner. Nothing is typed when the job owns the terminal, and another owner (a
 * command typed while paused) keeps the mark. A gone pane needs nothing.
 */
async function foreground(tmuxSession: string, pids: number[]): Promise<void> {
  const target = `=${tmuxSession}:`;
  const jobPgid: number | undefined = pids[1];
  const shellOwns = (t: Terminal) => t.tpgid === t.pgid;
  const jobOwns = (t: Terminal) =>
    jobPgid === undefined ? !shellOwns(t) : t.tpgid === jobPgid;
  const first = await pollTerminal(
    target,
    (t) => shellOwns(t) || (jobPgid !== undefined && jobOwns(t)),
  );
  if (!first.terminal) return;
  if (!first.met) {
    if (jobPgid === undefined) return;
    throw new ConflictError("unpause-incomplete", { reason: OTHER_OWNER });
  }
  if (jobOwns(first.terminal)) return;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) {
      const now = await Promise.resolve(pauseTools.paneTerminal(target)).catch(
        () => null,
      );
      if (!now || jobOwns(now) || !shellOwns(now)) return;
    }
    try {
      await pauseTools.sendKeys(target, ["C-u"]);
      await pauseTools.sendLiteral(target, "fg %1");
      await pauseTools.sendKeys(target, ["Enter"]);
    } catch {
      return;
    }
    const handed = await pollTerminal(target, jobOwns);
    if (!handed.terminal || handed.met) return;
  }
  throw new ConflictError("unpause-incomplete", {
    reason: "the shell did not hand the terminal back",
  });
}

/**
 * Continue every process of a paused card's session and clear the mark.
 *
 * @remarks Runs under the card lock. The stored pids are continued first, so unpause works when
 * `ps` or tmux fails. The mark clears even when the pane is gone, and stays when another process
 * owns the terminal or the shell keeps it after the retry.
 */
export async function unpauseCard(
  cardId: string,
  opts: { reason: string },
): Promise<Card> {
  const result = await withCardLock(
    cardId,
    async () => {
      const card = requireCard(cardId);
      if (!card.paused) throw new ConflictError("not-paused");
      const session = activeSession(card);
      const pids = session ? await panePidsOf(session.tmuxSession) : undefined;
      if (session && pids)
        await assertTerminalFree(session.tmuxSession, card.paused.pids);
      continueOrphans(card.paused.pids);
      if (session && pids) {
        await pauseTools.signalTree(pids, "SIGCONT");
        try {
          await foreground(session.tmuxSession, card.paused.pids);
        } catch (err) {
          await pauseTools.signalTree(pids, "SIGSTOP");
          throw err;
        }
      }
      await store.clearCardPaused(card.id);
      if (session)
        record(card, session, { action: "resume", reason: opts.reason });
      return requireCard(card.id);
    },
    { allowPaused: true },
  );
  if (result !== "busy") return result;
  if (!requireCard(cardId).paused) throw new ConflictError("not-paused");
  throw new ConflictError("busy");
}
