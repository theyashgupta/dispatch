/**
 * Move one id of the chain order from index `from` to index `to`.
 *
 * @remarks The result always holds every id of `ids` exactly once, so the server never gets a
 * partial list. A move onto the same slot or out of range returns the order unchanged.
 */
export function moveChainOrder(
  ids: readonly string[],
  from: number,
  to: number,
): string[] {
  const inRange = (i: number) =>
    Number.isInteger(i) && i >= 0 && i < ids.length;
  if (!inRange(from) || !inRange(to) || from === to) return [...ids];
  const next = [...ids];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}
