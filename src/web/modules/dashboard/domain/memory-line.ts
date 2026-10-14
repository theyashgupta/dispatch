import { isLoopCard } from "../../../../shared/running-group.js";
import type { Card, SystemMemory } from "../../../../shared/types.js";

export function pausedLoopCount(cards: readonly Card[]): number {
  return cards.filter((card) => isLoopCard(card) && card.paused).length;
}

/** Build the dashboard memory line, or null while there is no supported reading. */
export function memoryLine(
  reading: SystemMemory | undefined,
  pausedCount: number,
): string | null {
  if (reading === undefined || !reading.supported) return null;
  const { freeMb, swapUsedMb, swapTotalMb } = reading.sample;
  const paused = pausedCount >= 1 ? `, ${pausedCount} paused` : "";
  const stale = reading.stale ? " (stale)" : "";
  return `Memory: ${Math.round(freeMb)} MB free, swap ${Math.round(swapUsedMb)} of ${Math.round(swapTotalMb)} MB${paused}${stale}`;
}
