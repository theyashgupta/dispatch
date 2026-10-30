import type { Card, Session, SupervisorState } from "../../../shared/types.js";
import { DEFAULT_BOARD_KEY } from "../../../shared/board-key.js";
import { isLoopCard } from "../../../shared/running-group.js";
import { FROZEN_RELAUNCH_MINUTES } from "../../../shared/orchestrator-limits.js";
import { boardRepository as store } from "../../store/board-repository.js";
import type { PaneSample } from "../../adapters/markers/watcher.js";
import {
  paneAtPrompt,
  sessionEnvHas,
  widenNarrowWindow,
} from "../../adapters/tmux.js";
import { readTranscriptTail } from "../../adapters/transcript.js";
import {
  detectState,
  initialMemory,
  type DetectMemory,
  type Detection,
} from "../domain/supervisor-state.js";
import { promiseCompletes } from "../domain/loop-completion.js";
import { groupStateOfSupervisor } from "../domain/group-state.js";
import {
  holdsNeedsInput,
  initialPlanMemory,
  planActions,
  planFrozenRelaunch,
  type LoopFacts,
  type PlanMemory,
} from "../domain/supervisor-plan.js";
import { holdsReleased } from "../domain/session-release.js";
import { recordGroupState } from "./group-state-events.js";
import { driveWake, wakeInFlight } from "./orchestrator-wake.js";
import { runActions, runPlanned } from "./supervisor-actions.js";
import {
  checkHandoffCancel,
  checkHandoffThreshold,
} from "./supervisor-handoff.js";
import {
  moveToNeedsInput,
  orchestratorOf,
  ownerPolicy,
  record,
} from "./supervisor-record.js";
import { sessionTranscriptPath } from "./supervisor-transcript.js";
import { releaseIfDue } from "./session-release.js";
import { refreshLoopProgress } from "./loop-progress-reader.js";
import { floorExiting } from "./floor-release.js";
import { footer } from "./session-account-move.js";
import { READY, SHELL_SESSION_ENV } from "./steps.js";

export interface SupervisorWatcher {
  tmuxSession: string;
  memory: DetectMemory;
  running: boolean;
  shellRoot: boolean;
  plan: PlanMemory;
  progressRead: boolean;
  closeTriedAt: number;
  relaunchedFor: string | null;
}

const CLOSE_RETRY_MS = 60_000;

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
      closeTriedAt: 0,
      relaunchedFor: null,
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
  const groupState = groupStateOfSupervisor(change.state);
  if (groupState !== null)
    recordGroupState(card, groupState, change.state, session.id);
  if (change.state === "needs_input")
    await moveToNeedsInput(card, session, change.evidence);
  return from;
}

/**
 * The loop facts the planner reads for a card, or null for a card with no loop.
 *
 * @remarks
 * An orchestrator has no unit or phase, so its once-per-phase continue budget is keyed by
 * the UTC day: a days-long orchestrator gets one continue per duty each day, not one for its life.
 */
function loopOf(card: Card, now: number): LoopFacts | null {
  const owner = orchestratorOf(card);
  if (owner) {
    return {
      engineActive: owner.state === "running",
      handoffPending: owner.handoffReady === true,
      unitPhase: `orchestrator/${new Date(now).toISOString().slice(0, 10)}`,
      orchestrator: true,
    };
  }
  const progress = card.loopProgress;
  if (!isLoopCard(card) || progress === undefined) return null;
  const { currentUnit, currentPhase } = progress.summary;
  return {
    engineActive:
      progress.engine?.active === true &&
      !progress.engine.closed &&
      progress.engine.keptOpen !== true,
    handoffPending: progress.engine?.handoffPending === true,
    unitPhase: `${currentUnit ?? "none"}/${currentPhase?.number ?? "none"}`,
  };
}

/**
 * The second source `detectState` checks before it reports `handoff_ready`.
 *
 * @remarks
 * A loop names it in its engine file. An orchestrator has none, so its record flag
 * `handoffReady` stands in for the `handoff-pending` value.
 */
function engineSessionIdOf(card: Card): string | null {
  const owner = orchestratorOf(card);
  if (owner) return owner.handoffReady === true ? "handoff-pending" : null;
  return card.loopProgress?.engine?.sessionId ?? null;
}

/** How long a session stays frozen before the relaunch; the env override is for the sandbox e2e. */
function frozenRelaunchMs(): number {
  return (
    Number(process.env.DISPATCH_FROZEN_RELAUNCH_MS) ||
    FROZEN_RELAUNCH_MINUTES * 60_000
  );
}

/**
 * Plan and run the frozen relaunch once the session has been frozen long enough.
 *
 * @remarks The clock starts at the stored `stateSince`, so a server restart does not reset it.
 */
async function relaunchIfDue(
  card: Card,
  session: Session,
  watcher: SupervisorWatcher,
  evidence: string,
  now: number,
): Promise<void> {
  const since = session.stateSince;
  if (
    since === undefined ||
    watcher.relaunchedFor === since ||
    now - Date.parse(since) < frozenRelaunchMs()
  )
    return;
  watcher.relaunchedFor = since;
  const planned = planFrozenRelaunch(loopOf(card, now), watcher.plan, since);
  watcher.plan = planned.memory;
  await runActions(card, session, planned.actions, evidence);
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
    loop: loopOf(card, now),
    usageLimit: ownerPolicy(card)?.usageLimit ?? "wait",
    wokeAt: lastWakeAt,
    now,
    memory: plan,
  });
  return planned.actions.length > 0
    ? runPlanned(card, session, planned, plan, change.evidence)
    : planned.memory;
}

/**
 * Record a lost session and run the resume duty once.
 *
 * @remarks A lost session leaves the watcher's capture set, so the store's `session_lost` event
 * is its only signal; a session already marked lost is not resumed twice. A partial loss (the card
 * still has a live session, emitted when a paused session dies) is not a lost card.
 */
export async function superviseLost(cardId: string): Promise<void> {
  const card = store.getCard(cardId);
  const session = card?.sessions?.find((s) => s.id === card.activeSessionId);
  if (
    !card ||
    card.sessionLost !== true ||
    !session ||
    session.state === "lost" ||
    session.state === "released"
  )
    return;
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
 * @remarks Sessions on a board with `supervisor: off` get no watcher, no state and no event. A sample
 * that arrives while the same session is still being sampled, or while a wake line is being typed
 * into the pane, is skipped. A group card's loop files are read before its first plan, and an orchestrator
 * card gets the wake duty after the sample's own state work, which a state change skips. The first sample
 * of a new watcher that reads a stored `usage_limit_wait` plans once as if from no state, so a restart
 * re-arms the limit move or wait. A session that stays `frozen` past the relaunch delay gets the
 * relaunch duty once per freeze.
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
  const created = !watchers.has(sample.tmuxSession);
  const watcher = ensureWatcher(sample.tmuxSession, session.state ?? null);
  if (watcher.running || wakeInFlight(card)) return;
  watcher.running = true;
  try {
    await widenNarrowWindow(sample.tmuxSession);
    if (isLoopCard(card) && !watcher.progressRead) {
      await refreshLoopProgress(card.id);
      watcher.progressRead = true;
    }
    const [transcript, shellPrompt] = await Promise.all([
      sessionTranscriptPath(card, session).then((f) =>
        f === null ? null : readTranscriptTail(f),
      ),
      atShellPrompt(watcher),
    ]);
    const engine = card.loopProgress?.engine;
    const engineOpen = engine?.active === true && !engine.closed;
    const detection = detectState({
      now,
      tmuxAlive: true,
      atShellPrompt: shellPrompt,
      paused: card.paused ?? null,
      pane: sample.pane,
      contextPercent: session.contextPercent ?? null,
      engineSessionId: engineSessionIdOf(card),
      completion: promiseCompletes(
        card.loopProgress,
        engineOpen,
        transcript?.lastAssistantText,
      )
        ? "complete"
        : (card.loopProgress?.completion ?? null),
      engineOpen,
      slug: card.loopProgress?.slug ?? null,
      transcript,
      memory: watcher.memory,
    });
    watcher.memory = detection.memory;
    const claudeShown = !shellPrompt && READY.test(footer(sample.pane));
    const changed =
      detection.state !== (session.state ?? null) &&
      !holdsReleased(
        session.state ?? null,
        claudeShown && !floorExiting(session.id),
      ) &&
      !holdsNeedsInput(
        session.state ?? null,
        session.stateReason,
        detection,
        engineOpen,
      );
    if (changed)
      watcher.plan = await act(card, session, detection, watcher.plan, now);
    if (changed && detection.state === "roadmap_complete")
      watcher.closeTriedAt = now;
    if (
      !changed &&
      detection.state === "roadmap_complete" &&
      engineOpen &&
      now - watcher.closeTriedAt >= CLOSE_RETRY_MS
    ) {
      watcher.closeTriedAt = now;
      await runActions(
        card,
        session,
        [{ kind: "close_loop" }],
        detection.evidence,
      );
    }
    if (!changed && session.state === "frozen" && detection.state === "frozen")
      await relaunchIfDue(card, session, watcher, detection.evidence, now);
    await releaseIfDue(card, session, detection, changed, now);
    if (
      created &&
      !changed &&
      detection.state === "usage_limit_wait" &&
      session.stateReason === undefined
    ) {
      const planned = planActions({
        from: null,
        to: detection.state,
        loop: loopOf(card, now),
        usageLimit: ownerPolicy(card)?.usageLimit ?? "wait",
        wokeAt: lastWakeAt,
        now,
        memory: watcher.plan,
      });
      watcher.plan = planned.memory;
      if (planned.actions.length > 0)
        await runActions(card, session, planned.actions, detection.evidence);
    }
    if (
      (detection.state === "working" || detection.state === "idle") &&
      store.getCard(card.id)?.sessions?.find((s) => s.id === session.id)
        ?.stateReason === undefined
    ) {
      await checkHandoffThreshold(card, session, board.policy);
      await checkHandoffCancel(card, session, now);
    }
    if (!changed)
      driveWake(card, session, sample.pane, board.policy.wakeMinutes, now);
  } finally {
    watcher.running = false;
  }
}
