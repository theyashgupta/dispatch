import type { MemorySample, SystemMemory } from "../../shared/types.js";
import { admitStart } from "../services/domain/memory-admission.js";
import { recordSample } from "../services/orchestration/memory-governor.js";
import { memoryWaitTools } from "../services/orchestration/memory-wait.js";

const POLICY = { memoryFloorMb: 1024, swapCeilingMb: 8192 };

export interface MemoryClock {
  slept: number[];
  now: () => number;
  onSleep: (hook: () => void) => void;
}

export function memorySample(over: Partial<MemorySample> = {}): MemorySample {
  return {
    at: new Date().toISOString(),
    freeMb: 2048,
    compressorMb: 1000,
    swapUsedMb: 1000,
    swapTotalMb: 8192,
    load1: 1,
    ...over,
  };
}

export function recordMemory(freeMb: number, swapUsedMb: number): void {
  recordSample(memorySample({ freeMb, swapUsedMb }));
}

/** Build a supported, fresh memory reading with the given free memory and swap use. */
export function memoryReading(freeMb: number, swapUsedMb = 1000): SystemMemory {
  return {
    supported: true,
    stale: false,
    sample: memorySample({ freeMb, swapUsedMb }),
  };
}

/**
 * Run `run` with the memory wait tools replaced by a scripted reader and a fake clock.
 *
 * @remarks A number reads as that many free MB. The last reading repeats once the list runs out.
 */
export async function withMemoryFakes(
  readings: SystemMemory[] | number[],
  run: (clock: MemoryClock) => Promise<void>,
): Promise<void> {
  const queue = readings.map((r) =>
    typeof r === "number" ? memoryReading(r) : r,
  );
  const last = queue[queue.length - 1]!;
  const saved = { ...memoryWaitTools };
  let time = 0;
  let hook: () => void = () => {};
  const slept: number[] = [];
  memoryWaitTools.check = () => admitStart(queue.shift() ?? last, POLICY);
  memoryWaitTools.now = () => time;
  memoryWaitTools.sleep = (ms) => {
    hook();
    slept.push(ms);
    time += ms;
    return Promise.resolve();
  };
  try {
    await run({
      slept,
      now: () => time,
      onSleep: (h) => {
        hook = h;
      },
    });
  } finally {
    Object.assign(memoryWaitTools, saved);
  }
}
