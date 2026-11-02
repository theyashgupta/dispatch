import { formatCount } from "../../../../shared/format-count.js";

/** Join a label and its non-empty spoken parts with commas. */
export function railLabel(label: string, parts: readonly string[]): string {
  return [label, ...parts.filter((p) => p.length > 0)].join(", ");
}

/** Spoken label of the collapsed Boards icon: selected board key, live loops and needs-you count. */
export function boardsRailLabel(
  selected: { key: string; loops: number } | null,
  needsYou: number,
): string {
  const counts: string[] = [];
  if (selected !== null && selected.loops > 0) {
    counts.push(`${formatCount(selected.loops)} live`);
  }
  if (needsYou > 0) counts.push(`${formatCount(needsYou)} need you`);
  if (counts.length === 0) return "Boards";
  return railLabel(
    "Boards",
    selected === null ? counts : [selected.key, ...counts],
  );
}

/** Spoken label of the collapsed orchestrator icon. */
export function orchestratorRailLabel(
  label: string,
  badge: number | null,
): string {
  return badge === null
    ? label
    : railLabel(label, [`${formatCount(badge)} need you`]);
}

/** Label with its formatted count appended only when the count is positive. */
export function navRailLabel(label: string, count: number): string {
  return count > 0 ? railLabel(label, [formatCount(count)]) : label;
}

/** Dot tone of the collapsed Boards icon: needs-you wins over live loops. */
export function boardsRailDot(
  loops: number,
  needsYou: number,
): "accent" | "live" | null {
  if (needsYou > 0) return "accent";
  return loops > 0 ? "live" : null;
}

/** Dot tone of a collapsed nav icon: none without a count, muted for a neutral row. */
export function navRailDot(
  count: number,
  neutral: boolean,
): "accent" | "muted" | null {
  if (count <= 0) return null;
  return neutral ? "muted" : "accent";
}
