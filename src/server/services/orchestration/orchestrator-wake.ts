import { DEFAULT_BOARD_KEY } from "../../../shared/board-key.js";
import type {
  BoardKey,
  Card,
  OrchestrationEvent,
  OrchestratorRecord,
  Session,
} from "../../../shared/types.js";
import { boardRepository as store } from "../../store/board-repository.js";
import {
  enqueueReason,
  eventReason,
  mayWake,
  timerDue,
  timerReason,
  wakeLine,
  wakeTargetOf,
  withoutEvents,
  TIMER_KEY,
  type WakeReason,
} from "../domain/orchestrator-wake.js";
import { paneBusy, paneReady } from "../domain/supervisor-state.js";
import { scopeTargetOf } from "./boards.js";
import { onOrchestratorStop, setLastWake } from "./orchestrator-session.js";
import { turnStateOf } from "./session-turn.js";
import { sendConfirmed } from "./supervisor-send.js";
import { orchestratorOf, record } from "./supervisor-record.js";

interface WakeState {
  queue: WakeReason[];
  inFlight: boolean;
  lastLineAt: number | null;
  lastConfirmedAt: number | null;
}

export const wakeTools: { send: typeof sendConfirmed } = {
  send: sendConfirmed,
};

const STARTED_AT = Date.now();
const TOOL_CALL_LOOKBACK = 500;
const states = new Map<string, WakeState>();

const keyOf = (board: BoardKey, id: string): string => `${board}:${id}`;

function stateOf(key: string): WakeState {
  let state = states.get(key);
  if (state === undefined) {
    state = {
      queue: [],
      inFlight: false,
      lastLineAt: null,
      lastConfirmedAt: null,
    };
    states.set(key, state);
  }
  return state;
}

/**
 * Queue a wake reason for the orchestrator that owns a `decision_answered` or `group_state` event.
 *
 * @remarks Only a running orchestrator has a queue. A group event goes to the owner by the scope
 * rule, a decision answer to the orchestrator it names, and an `agent_done` event also goes to the main, because only the main ships.
 */
export function queueWakeReason(event: OrchestrationEvent): void {
  if (event.kind !== "decision_answered" && event.kind !== "group_state")
    return;
  const card = event.cardId === null ? undefined : store.getCard(event.cardId);
  const owner =
    event.kind === "group_state" && card
      ? (scopeTargetOf(card).owner ?? null)
      : null;
  const records = store.getBoard(event.boardKey)?.orchestrators ?? [];
  const targets = new Set([wakeTargetOf(event, owner)]);
  if (event.kind === "group_state" && event.data.state === "agent_done")
    targets.add(records.find((r) => r.role === "main")?.id ?? null);
  const reason = eventReason(event, card?.identifier ?? event.cardId ?? "?");
  if (reason === null) return;
  for (const id of targets) {
    const running = records.find((r) => r.id === id && r.state === "running");
    if (!running) continue;
    const state = stateOf(keyOf(event.boardKey, running.id));
    state.queue = enqueueReason(state.queue, reason);
  }
}

/**
 * Drop the queued reasons of events that an orchestrator received from `wait_for_event` or `list_events`.
 *
 * @remarks Only the exact events returned are dropped, so a wait filtered to one kind never drops
 * the reason of an earlier event of another kind that the orchestrator has not seen.
 */
export function recordDelivered(
  board: BoardKey,
  orchestratorId: string,
  eventIds: readonly number[],
): void {
  const state = states.get(keyOf(board, orchestratorId));
  if (state) state.queue = withoutEvents(state.queue, eventIds);
}

export function wakeInFlight(card: Card): boolean {
  const owner = orchestratorOf(card);
  if (!owner) return false;
  const board = card.boardKey ?? DEFAULT_BOARD_KEY;
  return states.get(keyOf(board, owner.id))?.inFlight ?? false;
}

function clearWake(board: BoardKey, orchestratorId: string): void {
  states.delete(keyOf(board, orchestratorId));
}

onOrchestratorStop(clearWake);

function lastToolCallAt(board: BoardKey, orchestratorId: string): number {
  const call = store
    .listLatestOrchestrationEvents(board, TOOL_CALL_LOOKBACK)
    .find(
      (e) => e.kind === "tool_call" && e.data.orchestratorId === orchestratorId,
    );
  return call ? Date.parse(call.ts) : 0;
}

function syncTimer(
  state: WakeState,
  board: BoardKey,
  orchestratorId: string,
  wakeMinutes: number,
  now: number,
): void {
  const quiet = Math.max(STARTED_AT, state.lastConfirmedAt ?? 0);
  const due =
    timerDue({ wakeMinutes, lastActivityAt: quiet, now }) &&
    timerDue({
      wakeMinutes,
      lastActivityAt: Math.max(quiet, lastToolCallAt(board, orchestratorId)),
      now,
    });
  const queued = state.queue.some((r) => r.key === TIMER_KEY);
  if (due && !queued)
    state.queue = enqueueReason(state.queue, timerReason(wakeMinutes));
  else if (!due && queued)
    state.queue = state.queue.filter((r) => r.key !== TIMER_KEY);
}

async function sendWake(
  card: Card,
  session: Session,
  owner: OrchestratorRecord,
  state: WakeState,
  reasons: WakeReason[],
  now: number,
): Promise<void> {
  const texts = reasons.map((r) => r.text);
  state.inFlight = true;
  state.lastLineAt = now;
  try {
    const result = await wakeTools.send(
      card,
      session,
      wakeLine(texts),
      "orchestrator_wake",
    );
    record(card, session, {
      action: "orchestrator_wake",
      orchestrator: owner.name,
      reasons: texts,
      result,
    });
    if (result !== "confirmed") return;
    const sent = new Set(reasons.map((r) => r.key));
    state.queue = state.queue.filter((r) => !sent.has(r.key));
    state.lastConfirmedAt = now;
    await setLastWake(card.boardKey ?? DEFAULT_BOARD_KEY, owner.id, {
      reasons: texts,
      at: new Date(now).toISOString(),
    });
  } catch (err) {
    console.warn(
      `[orchestrator] wake of ${owner.id} failed: ${(err as Error).message}`,
    );
  } finally {
    state.inFlight = false;
  }
}

/**
 * Run the wake duty for one pane sample of a card: sync the timer reason, then type one line when the send rule allows.
 *
 * @remarks Does nothing for a card that is not an orchestrator card. A record that is not `running`
 * loses its queue. The send is started and not awaited, so the sample loop never waits on it.
 */
export function driveWake(
  card: Card,
  session: Session,
  pane: string,
  wakeMinutes: number,
  now: number,
): void {
  const owner = orchestratorOf(card);
  if (!owner) return;
  const board = card.boardKey ?? DEFAULT_BOARD_KEY;
  const key = keyOf(board, owner.id);
  if (owner.state !== "running") {
    states.delete(key);
    return;
  }
  const state = stateOf(key);
  syncTimer(state, board, owner.id, wakeMinutes, now);
  const reasons = state.queue;
  if (reasons.length === 0) return;
  if (
    !mayWake({
      inFlight: state.inFlight,
      sessionState: session.state ?? null,
      lastLineAt: state.lastLineAt,
      now,
      paneReady: paneReady(pane),
      paneBusy: paneBusy(pane),
      turn: turnStateOf(card.id, session.id, pane),
    })
  )
    return;
  void sendWake(card, session, owner, state, reasons, now);
}
