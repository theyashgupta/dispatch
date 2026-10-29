import type { ShortcutEntry } from "../../../../shared/shortcuts.js";

export const PR_SHORTCUTS = [
  { key: "j", label: "Next row" },
  { key: "k", label: "Previous row" },
  { key: "Enter", label: "Open" },
] as const satisfies readonly ShortcutEntry[];

/**
 * Pick the row key a j or k press moves the cursor to.
 *
 * @remarks
 * A cursor that is not reachable (its group collapsed) starts from its place in the full key list
 * and takes the next reachable key in the step direction. When none lies that way, j lands on the
 * last reachable key and k on the first.
 */
export function nextCursorKey(
  keys: readonly string[],
  reachable: ReadonlySet<string>,
  cursor: string | null,
  step: 1 | -1,
): string | null {
  const open = keys.filter((key) => reachable.has(key));
  const first = open[0];
  const last = open[open.length - 1];
  if (first === undefined || last === undefined) return null;
  if (cursor === null) return first;
  const at = open.indexOf(cursor);
  if (at >= 0)
    return open[Math.max(0, Math.min(open.length - 1, at + step))] ?? null;
  const place = keys.indexOf(cursor);
  if (place < 0) return first;
  const ahead =
    step > 0
      ? keys.slice(place + 1).find((key) => reachable.has(key))
      : keys
          .slice(0, place)
          .reverse()
          .find((key) => reachable.has(key));
  return ahead ?? (step > 0 ? last : first);
}
