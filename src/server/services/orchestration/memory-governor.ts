import { EventEmitter } from "node:events";
import { readMemory } from "../../adapters/memory-sampler.js";
import { boardRepository as store } from "../../store/board-repository.js";
import { defaultBoardPolicy } from "../../../shared/board-key.js";
import type {
  BoardKey,
  MemorySample,
  SystemMemory,
} from "../../../shared/types.js";
import { ConflictError } from "../domain/errors.js";
import { admitStart } from "../domain/memory-admission.js";
import type { PolicyCheck } from "../domain/orchestrator-policy.js";

const SAMPLE_MS = 15_000;
const STALE_MS = 60_000;

let latest: MemorySample | null = null;

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
 * Sample memory at boot and every 15 seconds after.
 *
 * @remarks A failed read keeps the previous sample and re-broadcasts it, so stream clients see it
 * turn stale after 60 seconds.
 */
export function startMemoryGovernor(read = readMemory): () => void {
  const tick = (): void => {
    void read()
      .then((sample) => {
        if (sample !== null) recordSample(sample);
        else if (latest !== null) {
          memoryEmitter.emit("change", systemMemory());
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

export function memoryCheck(boardKey: BoardKey): PolicyCheck {
  const policy =
    store.getBoard(boardKey)?.policy ?? defaultBoardPolicy(boardKey);
  return admitStart(systemMemory(), policy);
}

/** Throw the 409 `memory-pressure` with its reason when a board has no memory headroom for a loop start. */
export function assertMemoryHeadroom(boardKey: BoardKey): void {
  const check = memoryCheck(boardKey);
  if (!check.ok) {
    throw new ConflictError("memory-pressure", { reason: check.reason });
  }
}
