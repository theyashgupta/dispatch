import { isLoopCard } from "../../../../shared/running-group.js";
import type { Card, SystemMemory } from "../../../../shared/types.js";

export const STALE_SUFFIX = " (stale)";

export interface MemoryLine {
  text: string;
  stale: boolean;
}

/** Count the loop cards that carry a paused mark. */
export function pausedLoopCount(cards: readonly Card[]): number {
  return cards.filter((card) => isLoopCard(card) && card.paused).length;
}

/** Build the dashboard memory line, or null while there is no supported reading. */
export function memoryLine(
  reading: SystemMemory | undefined,
  pausedCount: number,
): MemoryLine | null {
  if (reading === undefined || !reading.supported) return null;
  const { freeMb, swapUsedMb, swapTotalMb } = reading.sample;
  const paused = pausedCount >= 1 ? `, ${pausedCount} paused` : "";
  return {
    text: `Memory: ${Math.round(freeMb)} MB free, swap ${Math.round(swapUsedMb)} of ${Math.round(swapTotalMb)} MB${paused}`,
    stale: reading.stale,
  };
}
