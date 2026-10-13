import type { BoardPolicy, SystemMemory } from "../../../shared/types.js";
import type { PolicyCheck } from "./orchestrator-policy.js";

/**
 * Refuse a loop start when free memory is below the floor or swap used is above the ceiling.
 *
 * @remarks No reading or a stale reading admits, so a sampler fault never blocks every start.
 */
export function admitStart(
  memory: SystemMemory,
  policy: Pick<BoardPolicy, "memoryFloorMb" | "swapCeilingMb">,
): PolicyCheck {
  if (!memory.supported || memory.stale) return { ok: true };
  const { freeMb, swapUsedMb } = memory.sample;
  if (freeMb < policy.memoryFloorMb) {
    return {
      ok: false,
      reason: `free memory ${freeMb} MB is below the ${policy.memoryFloorMb} MB floor`,
    };
  }
  if (swapUsedMb > policy.swapCeilingMb) {
    return {
      ok: false,
      reason: `swap used ${swapUsedMb} MB is above the ${policy.swapCeilingMb} MB ceiling`,
    };
  }
  return { ok: true };
}
