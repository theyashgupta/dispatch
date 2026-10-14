import type { MemorySample } from "../../shared/types.js";
import { recordSample } from "../services/orchestration/memory-governor.js";

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
