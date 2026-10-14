import type {
  BoardKey,
  PausedBy,
  SystemMemory,
} from "../../../shared/types.js";

export interface PauseCandidate {
  cardId: string;
  boardKey: BoardKey;
  startedAt: string;
  pausedBy: PausedBy | null;
  coolingDown: boolean;
}

export interface PauseRun {
  lastPauseSwapMb: number | null;
  lowReadings: number;
}

export const IDLE_RUN: PauseRun = { lastPauseSwapMb: null, lowReadings: 0 };

export type PauseAction =
  | { kind: "pause"; cardId: string; reason: string }
  | { kind: "resume"; cardId: string; reason: string }
  | { kind: "none" };

const CASCADE_GUARD_MB = 256;
const RESUME_MARGIN_MB = 1024;
const RESUME_READINGS = 2;

const byStartedAt = (a: PauseCandidate, b: PauseCandidate): number =>
  Date.parse(a.startedAt) - Date.parse(b.startedAt) ||
  a.cardId.localeCompare(b.cardId);

/**
 * Decide the one pause or resume a memory reading calls for.
 *
 * @remarks A pause needs swap to grow 256 MB past the swap of the last pause in the same run, because
 * SIGSTOP frees no memory and the next reading would otherwise pause every loop in turn. The run ends
 * when swap falls below the resume floor, which is the ceiling minus 1024 MB and never below half the ceiling.
 */
export function decideMemoryPause(input: {
  memory: SystemMemory;
  candidates: PauseCandidate[];
  ceilings: Partial<Record<BoardKey, number>>;
  run: PauseRun;
}): { action: PauseAction; next: PauseRun } {
  const { memory, candidates, ceilings, run } = input;
  const none: PauseAction = { kind: "none" };
  if (!memory.supported || memory.stale)
    return { action: none, next: IDLE_RUN };
  const limits = candidates
    .filter((c) => c.pausedBy !== "user")
    .map((c) => ceilings[c.boardKey])
    .filter((n): n is number => n !== undefined);
  if (limits.length === 0) return { action: none, next: IDLE_RUN };
  const ceiling = Math.min(...limits);
  const used = memory.sample.swapUsedMb;

  if (used > ceiling) {
    const last = run.lastPauseSwapMb;
    if (last !== null && used < last + CASCADE_GUARD_MB) {
      return { action: none, next: { lastPauseSwapMb: last, lowReadings: 0 } };
    }
    const target = candidates
      .filter((c) => c.pausedBy === null && !c.coolingDown)
      .sort((a, b) => byStartedAt(b, a))[0];
    if (!target) {
      return { action: none, next: { lastPauseSwapMb: last, lowReadings: 0 } };
    }
    return {
      action: {
        kind: "pause",
        cardId: target.cardId,
        reason: `swap used ${used} MB is above the ${ceiling} MB ceiling`,
      },
      next: { lastPauseSwapMb: used, lowReadings: 0 },
    };
  }

  const floor = Math.max(ceiling - RESUME_MARGIN_MB, Math.floor(ceiling / 2));
  const low = used < floor ? run.lowReadings + 1 : 0;
  const target = candidates
    .filter((c) => c.pausedBy === "memory" && !c.coolingDown)
    .sort(byStartedAt)[0];
  if (low >= RESUME_READINGS && target) {
    return {
      action: {
        kind: "resume",
        cardId: target.cardId,
        reason: `swap used ${used} MB is below ${floor} MB`,
      },
      next: IDLE_RUN,
    };
  }
  return {
    action: none,
    next: {
      lastPauseSwapMb: used < floor ? null : run.lastPauseSwapMb,
      lowReadings: low,
    },
  };
}
