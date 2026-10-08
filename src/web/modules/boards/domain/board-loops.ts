import type { BoardCount } from "../../../../shared/types.js";

const SHOWN = 3;

/**
 * The Loops cell labels: "<group id> <percent>%" per running loop, at most three, then "+<n> more".
 *
 * @remarks Returns null for no loops so the cell shows a plain "0" like the other zero counts.
 */
export function loopsLabels(loops: BoardCount["loops"]): string[] | null {
  if (loops.length === 0) return null;
  const parts = loops
    .slice(0, SHOWN)
    .map((loop) => `${loop.groupId} ${loop.percent}%`);
  if (loops.length > SHOWN) parts.push(`+${loops.length - SHOWN} more`);
  return parts;
}
