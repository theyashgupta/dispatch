export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Side = "left" | "right" | "top" | "bottom";

export const TOKEN_CAP = 40;

/**
 * Pick the facing sides an edge leaves `from` and enters `to` by.
 *
 * @remarks Compares the distance between centers, not between edges, so a node offset diagonally
 * still joins side to side; a tie picks the horizontal sides.
 */
export function anchorSides(from: Rect, to: Rect): { from: Side; to: Side } {
  const dx = to.x + to.w / 2 - (from.x + from.w / 2);
  const dy = to.y + to.h / 2 - (from.y + from.h / 2);
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0
      ? { from: "right", to: "left" }
      : { from: "left", to: "right" };
  }
  return dy >= 0
    ? { from: "bottom", to: "top" }
    : { from: "top", to: "bottom" };
}

function anchor(rect: Rect, side: Side): { x: number; y: number } {
  switch (side) {
    case "left":
      return { x: rect.x, y: rect.y + rect.h / 2 };
    case "right":
      return { x: rect.x + rect.w, y: rect.y + rect.h / 2 };
    case "top":
      return { x: rect.x + rect.w / 2, y: rect.y };
    case "bottom":
      return { x: rect.x + rect.w / 2, y: rect.y + rect.h };
  }
}

/** A cubic SVG path from the facing anchor of `from` to the facing anchor of `to`. */
export function edgePath(from: Rect, to: Rect): string {
  return chainPath([from, to]);
}

/** One continuous path through every rect in order, for a token that rides several edges. */
export function chainPath(rects: readonly Rect[]): string {
  const parts: string[] = [];
  for (let i = 1; i < rects.length; i++) {
    const sides = anchorSides(rects[i - 1], rects[i]);
    const s = anchor(rects[i - 1], sides.from);
    const e = anchor(rects[i], sides.to);
    const horizontal = sides.from === "left" || sides.from === "right";
    const half = horizontal ? Math.abs(e.x - s.x) / 2 : Math.abs(e.y - s.y) / 2;
    const dir = sides.from === "right" || sides.from === "bottom" ? 1 : -1;
    const c1 = horizontal
      ? { x: s.x + dir * half, y: s.y }
      : { x: s.x, y: s.y + dir * half };
    const c2 = horizontal
      ? { x: e.x - dir * half, y: e.y }
      : { x: e.x, y: e.y - dir * half };
    if (i === 1) parts.push(`M ${s.x} ${s.y}`);
    parts.push(`C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${e.x} ${e.y}`);
  }
  return parts.join(" ");
}

/**
 * Whether one more token may start while `inFlight` are travelling.
 *
 * @remarks A token over the cap is dropped, not queued, so a burst never builds a backlog.
 */
export function admitToken(inFlight: number, cap = TOKEN_CAP): boolean {
  return inFlight < cap;
}
