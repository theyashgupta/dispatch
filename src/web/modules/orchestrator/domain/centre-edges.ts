interface Point {
  x: number;
  y: number;
}

/** Pick the source node of an edge: an unnamed tile uses the unnamed node. */
export function pickSource<T>(
  from: string | null,
  sources: ReadonlyMap<string, T>,
): T | null {
  return sources.get(from ?? "") ?? null;
}

/**
 * Build the SVG path of one elbow edge: a run right from the node, a vertical run at the middle, a run right into the tile.
 *
 * @remarks Coordinates are rounded to whole pixels so the one-pixel stroke stays sharp.
 */
export function elbowPath(from: Point, to: Point): string {
  const midX = Math.round((from.x + to.x) / 2);
  return `M${Math.round(from.x)} ${Math.round(from.y)}H${midX}V${Math.round(to.y)}H${Math.round(to.x)}`;
}
