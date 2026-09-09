import type { ClaudeSession } from "../../shared/types.js";

/** Longest a latest-node `lastActiveAt` bump may be held back before it must persist. */
export const CLAUDE_SESSION_TOUCH_MS = 60_000;

/**
 * The conversation Resume should open: the newest node by `lastActiveAt` that is not missing.
 *
 * @remarks Ordered by activity, not creation, so a user who manually reopens an older
 * conversation is followed by Resume once its hooks report activity. A tie goes to the later
 * node, the one appended last.
 */
export function latestClaudeSession(
  nodes: ClaudeSession[] | undefined,
): ClaudeSession | undefined {
  let latest: ClaudeSession | undefined;
  for (const node of nodes ?? []) {
    if (node.missingAt != null) continue;
    if (latest === undefined || node.lastActiveAt >= latest.lastActiveAt)
      latest = node;
  }
  return latest;
}

/**
 * Record activity for conversation `id` at `now`: returns the node list with a new node for an
 * unknown id or a bumped `lastActiveAt` for a known one, or `undefined` when nothing changes.
 *
 * @remarks Every store write persists the whole board and broadcasts a snapshot, so a bump on
 * the node that is already latest is dropped until {@link CLAUDE_SESSION_TOUCH_MS} has elapsed.
 * A bump on any other node applies at once, because it changes which node Resume opens, and is
 * stamped no earlier than the current latest node so a clock that stepped backwards can never
 * leave a new conversation sorted behind the old one. Pure: the caller peeks with it before
 * enqueueing and applies the returned list inside the queue.
 */
export function touchClaudeSession(
  nodes: ClaudeSession[] | undefined,
  id: string,
  now: string,
): ClaudeSession[] | undefined {
  const current = nodes ?? [];
  const node = current.find((n) => n.id === id);
  const latest = latestClaudeSession(current);
  const stamp =
    latest !== undefined && latest.lastActiveAt > now
      ? latest.lastActiveAt
      : now;
  if (node === undefined)
    return [...current, { id, createdAt: now, lastActiveAt: stamp }];
  if (
    latest?.id === id &&
    Date.parse(now) - Date.parse(node.lastActiveAt) < CLAUDE_SESSION_TOUCH_MS
  )
    return undefined;
  return current.map((n) => (n.id === id ? { ...n, lastActiveAt: stamp } : n));
}
