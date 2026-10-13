interface Point {
  x: number;
  y: number;
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
