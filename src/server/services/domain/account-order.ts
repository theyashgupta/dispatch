/**
 * Check that a requested chain order holds every current account id exactly once.
 *
 * @remarks A missing id, an unknown id or a repeated id makes the list invalid, so the caller writes nothing.
 */
export function isValidChainOrder(
  current: readonly string[],
  requested: readonly string[],
): boolean {
  return (
    requested.length === current.length &&
    new Set(requested).size === requested.length &&
    requested.every((id) => current.includes(id))
  );
}
