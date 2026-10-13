import type { ClaudeSession } from "../../shared/types.js";

/** Longest a latest-node `lastActiveAt` bump may be held back before it must persist. */
export const CLAUDE_SESSION_TOUCH_MS = 60_000;

/** When a conversation began: its `startedAt`, else the first event that named it. */
export function startOf(node: ClaudeSession): string {
  return node.startedAt ?? node.createdAt;
}

/**
 * The conversation Resume should open: the newest node by `startedAt ?? createdAt` that is not
 * missing.
 *
 * @remarks Ordered by start, so a late event of an older conversation never changes the result.
 * A SessionStart with source resume of an older conversation makes it the latest again, so a
 * conversation the user reopens is followed. A tie goes to the node appended last.
 */
export function latestClaudeSession(
  nodes: ClaudeSession[] | undefined,
): ClaudeSession | undefined {
  let latest: ClaudeSession | undefined;
  for (const node of nodes ?? []) {
    if (node.missingAt != null) continue;
    if (latest === undefined || startOf(node) >= startOf(latest)) latest = node;
  }
  return latest;
}

/**
 * Record activity for conversation `id` at `now`: returns the node list with a new node for an
 * unknown id or a bumped `lastActiveAt` for a known one, or `undefined` when nothing changes.
 *
 * @remarks Every store write persists the whole board and broadcasts a snapshot, so a bump on the
 * latest node is dropped until {@link CLAUDE_SESSION_TOUCH_MS} has elapsed. The clock clamp
 * applies to `lastActiveAt` only: it is stamped no earlier than the latest node's, and `startedAt`
 * is never changed, so a new node gets `startedAt: now`. The function is pure: the caller peeks
 * with it before enqueueing and applies the returned list inside the queue.
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
    return [
      ...current,
      { id, createdAt: now, lastActiveAt: stamp, startedAt: now },
    ];
  if (
    latest?.id === id &&
    Date.parse(now) - Date.parse(node.lastActiveAt) < CLAUDE_SESSION_TOUCH_MS
  )
    return undefined;
  return current.map((n) => (n.id === id ? { ...n, lastActiveAt: stamp } : n));
}

/**
 * Record a SessionStart for conversation `id` at `now`: returns the node list with a new node or
 * the existing node restarted.
 *
 * @remarks A start proves the conversation exists, so it clears `missingAt`. Unlike
 * {@link touchClaudeSession} it is never throttled, because it changes the start order.
 */
export function startClaudeSession(
  nodes: ClaudeSession[] | undefined,
  id: string,
  now: string,
): ClaudeSession[] {
  const current = nodes ?? [];
  if (!current.some((n) => n.id === id))
    return [
      ...current,
      { id, createdAt: now, lastActiveAt: now, startedAt: now },
    ];
  return current.map((n) => {
    if (n.id !== id) return n;
    const restarted = { ...n, startedAt: now, lastActiveAt: now };
    delete restarted.missingAt;
    return restarted;
  });
}
