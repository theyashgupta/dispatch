import { EventEmitter } from "node:events";
import { readMemory } from "../../adapters/memory-sampler.js";
import { boardRepository as store } from "../../store/board-repository.js";
import { ALL_BOARDS, defaultBoardPolicy } from "../../../shared/board-key.js";
import type {
  BoardKey,
  MemorySample,
  SystemMemory,
} from "../../../shared/types.js";
import { ConflictError } from "../domain/errors.js";
import { admitStart } from "../domain/memory-admission.js";
import {
  IDLE_RUN,
  decideAfterRestart,
  decideMemoryPause,
  type PauseAction,
  type PauseCandidate,
  type PauseRun,
} from "../domain/memory-pause.js";
import type { PolicyCheck } from "../domain/orchestrator-policy.js";
import {
  activeSession,
  pauseCard,
  pauseRefusal,
  unpauseCard,
} from "./pause-card.js";

const SAMPLE_MS = 15_000;
const STALE_MS = 60_000;
const COOLDOWN_MS = 5 * 60_000;

let latest: MemorySample | null = null;
let run: PauseRun = IDLE_RUN;
let stepping = false;
let restored = false;
let lastRefusal: string | null = null;
const cooldown = new Map<string, number>();

export const governorTools: {
  pauseCard: typeof pauseCard;
  unpauseCard: typeof unpauseCard;
} = { pauseCard, unpauseCard };

export const memoryEmitter = new EventEmitter();

export function recordSample(sample: MemorySample): void {
  latest = sample;
  memoryEmitter.emit("change", systemMemory());
}

/** Answer the latest reading with its stale flag, as the endpoint and the stream frame serve it. */
export function systemMemory(now = Date.now()): SystemMemory {
  if (latest === null) return { supported: false };
  return {
    supported: true,
    sample: latest,
    stale: now - Date.parse(latest.at) > STALE_MS,
  };
}

/**
 * Sample memory at boot and every 15 seconds after, and run the pause step on each recorded sample.
 *
 * @remarks A failed read keeps the previous sample and re-broadcasts it, so stream clients see it turn
 * stale after 60 seconds. The pause run survives a failed read until that sample is stale. A step still
 * in flight skips the next tick's step.
 */
export function startMemoryGovernor(read = readMemory): () => void {
  restored = false;
  const tick = (): void => {
    void read()
      .then(async (sample) => {
        if (sample === null) {
          const kept = systemMemory();
          if (!kept.supported || kept.stale) run = IDLE_RUN;
          if (latest !== null) memoryEmitter.emit("change", kept);
          return;
        }
        recordSample(sample);
        if (stepping) return;
        stepping = true;
        try {
          await memoryPauseStep();
        } finally {
          stepping = false;
        }
      })
      .catch((err: unknown) => {
        console.warn(`[memory] sample failed: ${(err as Error).message}`);
      });
  };
  tick();
  const timer = setInterval(tick, SAMPLE_MS);
  timer.unref();
  return () => clearInterval(timer);
}

function boardPolicy(boardKey: BoardKey) {
  return store.getBoard(boardKey)?.policy ?? defaultBoardPolicy(boardKey);
}

function pauseCandidates(): PauseCandidate[] {
  const now = Date.now();
  const out: PauseCandidate[] = [];
  for (const card of store.listCards(ALL_BOARDS)) {
    const session = activeSession(card);
    if (!session) continue;
    const pausedBy = card.paused?.by ?? null;
    if (pausedBy === "user") continue;
    if (
      pausedBy === null &&
      (card.column === "agent_done" ||
        card.column === "done" ||
        pauseRefusal(card) !== null)
    )
      continue;
    out.push({
      cardId: card.id,
      boardKey: card.boardKey,
      startedAt: session.createdAt,
      pausedBy,
      pausedSwapMb: card.paused?.swapMb,
      coolingDown: (cooldown.get(card.id) ?? 0) > now,
    });
  }
  return out;
}

/**
 * Pause or resume at most one loop card for the latest reading.
 *
 * @remarks Never throws. A refused or failed signal leaves the run state as it was, so the next
 * reading tries again, and the same refusal is logged once. The first fresh reading after start rebuilds
 * the run from the persisted governor marks, because a restart loses the in-memory run.
 */
export async function memoryPauseStep(memory = systemMemory()): Promise<void> {
  let action: PauseAction = { kind: "none" };
  try {
    const candidates = pauseCandidates();
    const ceilings: Partial<Record<BoardKey, number>> = {};
    for (const c of candidates) {
      ceilings[c.boardKey] ??= boardPolicy(c.boardKey).swapCeilingMb;
    }
    const decision =
      (restored
        ? null
        : decideAfterRestart({ memory, candidates, ceilings })) ??
      decideMemoryPause({ memory, candidates, ceilings, run });
    action = decision.action;
    if (action.kind === "pause") {
      await governorTools.pauseCard(action.cardId, {
        by: "memory",
        reason: action.reason,
        swapMb: action.swapMb,
      });
    } else if (action.kind === "resume") {
      await governorTools.unpauseCard(action.cardId, { reason: action.reason });
    }
    run = decision.next;
    if (memory.supported && !memory.stale) restored = true;
    lastRefusal = null;
    if (action.kind !== "none") cooldown.delete(action.cardId);
    if (action.kind === "none") return;
    const verb = action.kind === "pause" ? "paused" : "resumed";
    console.info(`[memory] ${verb} ${action.cardId}: ${action.reason}`);
  } catch (err) {
    const why = (err as { code?: string }).code ?? (err as Error).message;
    const id = action.kind === "none" ? "" : action.cardId;
    if (
      action.kind !== "none" &&
      err instanceof ConflictError &&
      err.code ===
        (action.kind === "pause" ? "not-pausable" : "unpause-incomplete")
    )
      cooldown.set(action.cardId, Date.now() + COOLDOWN_MS);
    const key = `${action.kind}:${id}:${why}`;
    if (key === lastRefusal) return;
    lastRefusal = key;
    console.warn(
      action.kind === "none"
        ? `[memory] pause step failed: ${why}`
        : `[memory] ${action.kind} ${id} refused: ${why}`,
    );
  }
}

export function memoryCheck(boardKey: BoardKey): PolicyCheck {
  return admitStart(systemMemory(), boardPolicy(boardKey));
}

/** Throw the 409 `memory-pressure` with its reason when a board has no memory headroom for a loop start. */
export function assertMemoryHeadroom(boardKey: BoardKey): void {
  const check = memoryCheck(boardKey);
  if (!check.ok) {
    throw new ConflictError("memory-pressure", { reason: check.reason });
  }
}
