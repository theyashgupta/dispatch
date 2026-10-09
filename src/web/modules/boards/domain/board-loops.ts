import type { BoardCount } from "../../../../shared/types.js";

const SHOWN = 3;

/**
 * The Loops cell labels for the first three running groups, then "+<n> more".
 *
 * @remarks Returns null for no loops so the cell shows a plain "0" like the other zero counts. A group with a null percent reads "<group id> no loop progress".
 */
export function loopsLabels(loops: BoardCount["loops"]): string[] | null {
  if (loops.length === 0) return null;
  const parts = loops
    .slice(0, SHOWN)
    .map((loop) =>
      loop.percent === null
        ? `${loop.groupId} no loop progress`
        : `${loop.groupId} ${loop.percent}%`,
    );
  if (loops.length > SHOWN) parts.push(`+${loops.length - SHOWN} more`);
  return parts;
}
