import type { Card, ReconcileResult } from "../../shared/types.js";

/**
 * The subset of a Linear issue the poller maps onto a card. `description` is nullable (issues can
 * have none); `priority` is the raw Linear integer (RESEARCH assumption A2: 1 urgent .. 4 low,
 * 0 none — verify on first real pull); `updatedAt` is an ISO string used as the To Do tiebreaker.
 */
export interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  url: string;
  description: string | null;
  priority: number;
  updatedAt: string;
}

/** Build a fresh To Do card for a newly-seen Linear issue. In Phase 1 card.id == issueId. */
function newTodoCard(issue: LinearIssue): Card {
  return {
    id: issue.id,
    issueId: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    url: issue.url,
    description: issue.description,
    priority: issue.priority,
    column: "todo",
    updatedAt: issue.updatedAt,
    goneFromLinear: false,
  };
}

/**
 * Reconcile a Linear poll against the current board. PURE — no I/O, no clock.
 *
 * `current` is keyed by Linear issue id (Card.issueId); in Phase 1 that equals card.id, so the
 * poller builds it directly from the store snapshot keyed by issueId.
 *
 * Rules (all keyed by Linear issue id):
 *  - Returned issue with no existing card  -> upsert a NEW To Do card (SYNC-01).
 *  - Returned issue whose card is in To Do -> upsert an in-place refresh of title/description/
 *    priority/updatedAt, clearing goneFromLinear (SYNC-02).
 *  - Returned issue whose card is PAST To Do -> NOT included in upserts; the poller never touches
 *    cards past To Do (SYNC-02). Exception: if the card is currently flagged goneFromLinear, the
 *    issue's reappearance emits a flag-only correction via `reappearedIds` — goneFromLinear is
 *    poller-owned derived state, not user board state, so clearing it does not violate the rule.
 *  - Current card whose issue is absent from the result: in To Do -> removeIds (SYNC-03: removed
 *    only in To Do); past To Do -> goneIds (kept, flagged goneFromLinear).
 *    CR-01 carve-out: a To Do card with a start saga IN FLIGHT (or already carrying
 *    provisioning/session state from one) is treated like a card past To Do — it is NEVER
 *    removed, only flagged goneFromLinear. Removing it mid-saga would orphan a live
 *    `claude --dangerously-skip-permissions` session and its worktrees with no card to reach them.
 *
 * `inFlightStartIds` is the store's transient set of card ids with a running start saga (threaded
 * in so this function stays PURE — it reads the set, it does not own or mutate it).
 *
 * Upserts are pushed in Linear-return order; the store orders To Do on read (no sort here).
 */
function isStartingCard(
  card: Card,
  inFlightStartIds: ReadonlySet<string>,
): boolean {
  return (
    inFlightStartIds.has(card.id) ||
    card.provisioningStep != null ||
    card.workspacePath != null ||
    card.tmuxSession != null
  );
}

/**
 * Reconcile a Linear poll against the current board and return upserts/removes/gone/reappeared.
 * @remarks SYNC-02/SYNC-03: pure and column-scoped — a new issue becomes a fresh To Do card; an
 * issue whose card is in To Do is refreshed in place (clearing goneFromLinear); a card past To Do
 * is untouched (a reappearing gone-flagged card emits a flag-only correction); an absent issue is
 * removed only while in To Do, else kept and flagged goneFromLinear (CR-01: an in-flight-start card
 * is flagged, never removed). Does no I/O, no clock read, and no sorting.
 * @see docs/ARCHITECTURE.md#linear-sync
 */
export function reconcile(
  issues: LinearIssue[],
  current: Map<string, Card>,
  inFlightStartIds: ReadonlySet<string> = new Set(),
): ReconcileResult {
  const seen = new Set(issues.map((i) => i.id));
  const upserts: Card[] = [];
  const reappearedIds: string[] = [];

  for (const issue of issues) {
    const existing = current.get(issue.id);
    if (!existing) {
      upserts.push(newTodoCard(issue));
      continue;
    }
    if (existing.column === "todo") {
      upserts.push({
        ...existing,
        title: issue.title,
        url: issue.url,
        description: issue.description,
        priority: issue.priority,
        updatedAt: issue.updatedAt,
        goneFromLinear: false,
      });
    } else if (existing.goneFromLinear) {
      reappearedIds.push(existing.id);
    }
  }

  const removeIds: string[] = [];
  const goneIds: string[] = [];
  for (const card of current.values()) {
    if (seen.has(card.issueId)) continue;
    if (card.column === "todo" && !isStartingCard(card, inFlightStartIds)) {
      removeIds.push(card.id);
    } else {
      goneIds.push(card.id);
    }
  }

  return { upserts, removeIds, goneIds, reappearedIds };
}
