import type { Card, Session, SupervisorState } from "../../../shared/types.js";
import { DEFAULT_BOARD_KEY } from "../../../shared/board-key.js";
import { boardRepository as store } from "../../store/board-repository.js";
import type { PaneSample } from "../../adapters/markers/watcher.js";
import { paneAtPrompt, sessionEnvHas } from "../../adapters/tmux.js";
import { readTranscriptTail } from "../../adapters/transcript.js";
import {
  detectState,
  initialMemory,
  type DetectMemory,
  type Detection,
} from "../domain/supervisor-state.js";
import {
  holdsNeedsInput,
  initialPlanMemory,
  planActions,
  type LoopFacts,
  type PlanMemory,
} from "../domain/supervisor-plan.js";
import { runActions } from "./supervisor-actions.js";
import {
  checkHandoffCancel,
  checkHandoffThreshold,
} from "./supervisor-handoff.js";
import { moveToNeedsInput, record } from "./supervisor-record.js";
import { sessionTranscriptPath } from "./supervisor-transcript.js";
import { refreshLoopProgress } from "./loop-progress-reader.js";
import { SHELL_SESSION_ENV } from "./steps.js";

export interface SupervisorWatcher {
  tmuxSession: string;
  memory: DetectMemory;
  running: boolean;
  shellRoot: boolean;
  plan: PlanMemory;
  progressRead: boolean;
}

const watchers = new Map<string, SupervisorWatcher>();
let lastWakeAt: number | null = null;

/** Record when the machine woke, for the sleep cut duty. */
export function noteMachineWake(at: number): void {
  lastWakeAt = at;
}

/** The watcher of one tmux session, created from the stored state on first use. */
export function ensureWatcher(
  tmuxSession: string,
  stored: SupervisorState | null = null,
): SupervisorWatcher {
  let watcher = watchers.get(tmuxSession);
  if (watcher === undefined) {
    watcher = {
      tmuxSession,
      memory: initialMemory(stored),
      running: false,
      shellRoot: false,
      plan: initialPlanMemory(),
      progressRead: false,
    };
    watchers.set(tmuxSession, watcher);
  }
  return watcher;
}

/** The tmux names that have a watcher. */
export function watcherNames(): string[] {
  return [...watchers.keys()];
}

/** Forget the watcher of a tmux session that is gone. */
export function dropWatcher(tmuxSession: string): void {
  watchers.delete(tmuxSession);
}

/**
 * Whether the pane shell is back at its prompt, which means claude exited.
 *
 * @remarks Only a session started under a login shell can show a shell prompt; an older session
 * whose pane root is claude itself always reads as at its prompt, so it never counts.
 */
async function atShellPrompt(watcher: SupervisorWatcher): Promise<boolean> {
  const target = `=${watcher.tmuxSession}`;
  if (!watcher.shellRoot)
    watcher.shellRoot = await sessionEnvHas(target, SHELL_SESSION_ENV);
  if (!watcher.shellRoot) return false;
  return paneAtPrompt(`${target}:`).catch(() => false);
}

type Change = Pick<Detection, "state" | "evidence" | "promptKind">;

/** Write one state change and its event; resolves the previous state, or undefined when refused. */
async function recordTransition(
  card: Card,
  session: Session,
  change: Change,
): Promise<SupervisorState | null | undefined> {
  const from = session.state ?? null;
  const written = await store.setSessionStateIfSession(
    card.id,
    session.id,
    change.state,
  );
  if (!written) return undefined;
  record(
    card,
    session,
    {
      from,
      to: change.state,
      evidence: change.evidence,
      ...(change.promptKind ? { promptKind: change.promptKind } : {}),
    },
    "supervisor_state",
  );
  if (change.state === "needs_input")
    await moveToNeedsInput(card, session, change.evidence);
  return from;
}

function loopOf(card: Card): LoopFacts | null {
  const progress = card.loopProgress;
  if (card.source !== "group" || progress === undefined) return null;
  const { currentUnit, currentPhase } = progress.summary;
  return {
    engineActive: progress.engine?.active === true && !progress.engine.closed,
    handoffPending: progress.engine?.handoffPending === true,
    unitPhase: `${currentUnit ?? "none"}/${currentPhase?.number ?? "none"}`,
  };
}

/** Record one change, then plan and run its actions in the same sampling turn. */
async function act(
  card: Card,
  session: Session,
  change: Change,
  plan: PlanMemory,
  now: number,
): Promise<PlanMemory> {
  const from = await recordTransition(card, session, change);
  if (from === undefined) return plan;
  const planned = planActions({
    from,
    to: change.state,
    ...(change.promptKind ? { promptKind: change.promptKind } : {}),
    loop: loopOf(card),
    usageLimit:
      store.getBoard(card.boardKey ?? DEFAULT_BOARD_KEY)?.policy.usageLimit ??
      "wait",
    wokeAt: lastWakeAt,
    now,
    memory: plan,
  });
  if (planned.actions.length > 0)
    await runActions(card, session, planned.actions, change.evidence);
  return planned.memory;
}

/**
 * Record a lost session and run the resume duty once.
 *
 * @remarks A lost session leaves the watcher's capture set, so the store's `session_lost` event
 * is its only signal; a session already marked lost is not resumed twice.
 */
export async function superviseLost(cardId: string): Promise<void> {
  const card = store.getCard(cardId);
  const session = card?.sessions?.find((s) => s.id === card.activeSessionId);
  if (!card || !session || session.state === "lost") return;
  if (
    store.getBoard(card.boardKey ?? DEFAULT_BOARD_KEY)?.policy.supervisor !==
    "on"
  )
    return;
  await act(
    card,
    session,
    { state: "lost", evidence: "tmux: session not found" },
    initialPlanMemory(),
    Date.now(),
  );
}

/**
 * Detect the state of one captured pane and record a change once.
 *
 * @remarks Sessions on a board with `supervisor: off` get no watcher, no state and no event.
 * A sample that arrives while the same session is still being sampled is skipped. A group
 * card's loop files are read before its first plan, so a duty right after boot counts under its
 * real unit and phase.
 */
export async function supervisePane(
  sample: PaneSample,
  now: number = Date.now(),
): Promise<void> {
  const card = store.getCard(sample.cardId);
  const session = card?.sessions?.find((s) => s.id === sample.sessionId);
  if (!card || !session || session.tmuxSession !== sample.tmuxSession) return;
  const board = store.getBoard(card.boardKey ?? DEFAULT_BOARD_KEY);
  if (board?.policy.supervisor !== "on") {
    watchers.delete(sample.tmuxSession);
    return;
  }
  const watcher = ensureWatcher(sample.tmuxSession, session.state ?? null);
  if (watcher.running) return;
  watcher.running = true;
  try {
    if (card.source === "group" && !watcher.progressRead) {
      await refreshLoopProgress(card.id);
      watcher.progressRead = true;
    }
    const [transcript, shellPrompt] = await Promise.all([
      sessionTranscriptPath(card, session).then((f) =>
        f === null ? null : readTranscriptTail(f),
      ),
      atShellPrompt(watcher),
    ]);
    const detection = detectState({
      now,
      tmuxAlive: true,
      atShellPrompt: shellPrompt,
      pane: sample.pane,
      engineSessionId: card.loopProgress?.engine?.sessionId ?? null,
      completion: card.loopProgress?.completion ?? null,
      transcript,
      memory: watcher.memory,
    });
    watcher.memory = detection.memory;
    const changed =
      detection.state !== (session.state ?? null) &&
      !holdsNeedsInput(session.state ?? null, session.stateReason, detection);
    if (changed)
      watcher.plan = await act(card, session, detection, watcher.plan, now);
    if (
      (detection.state === "working" || detection.state === "idle") &&
      store.getCard(card.id)?.sessions?.find((s) => s.id === session.id)
        ?.stateReason === undefined
    ) {
      await checkHandoffThreshold(card, session, board.policy);
      await checkHandoffCancel(card, session, now);
    }
  } finally {
    watcher.running = false;
  }
}
