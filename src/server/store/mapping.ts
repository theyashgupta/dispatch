import type { Card, ReconcileResult, SourceIssue } from "../../shared/types.js";

/** Build a fresh To Do card for a newly-seen source issue, stamped with its origin source. */
function newTodoCard(issue: SourceIssue, sourceId: string): Card {
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
    source: sourceId,
  };
}

/** CR-01 predicate: a start saga is in flight for the card, or it already carries provisioning/session state from one. */
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
 * Reconcile a source poll against the current board and return upserts/removes/gone/reappeared.
 * PURE — no I/O, no clock read, no sorting; upserts are pushed in provider-return order and the
 * store orders To Do on read. `current` is keyed by upstream issue id (Card.issueId), which today
 * equals card.id.
 * @remarks Rules, all keyed by upstream issue id:
 *  - Returned issue with no existing card -> upsert a NEW To Do card stamped with `sourceId`
 *    (SYNC-01).
 *  - Returned issue whose card is in To Do -> upsert an in-place refresh of title/url/description/
 *    priority/updatedAt, clearing goneFromLinear (SYNC-02).
 *  - Returned issue whose card is PAST To Do -> NOT included in upserts; the poller never touches
 *    cards past To Do (SYNC-02). Exception: a card currently flagged goneFromLinear emits a
 *    flag-only correction via `reappearedIds` — goneFromLinear is poller-owned derived state, not
 *    user board state, so clearing it does not violate the rule.
 *  - Current card whose issue is absent from the result: in To Do -> removeIds (SYNC-03: removed
 *    only in To Do); past To Do -> goneIds (kept, flagged goneFromLinear). CR-01 carve-out: a To Do
 *    card with a start saga in flight (or already carrying provisioning/session state from one) is
 *    NEVER removed, only flagged — removing it mid-saga would orphan a live session and its
 *    worktrees with no card to reach them.
 * Removal/gone decisions are scoped to the syncing source: the caller passes a `current`
 * pre-filtered to `sourceId`'s cards, so SYNC-03 removals can never touch another source's card.
 * `inFlightStartIds` is the store's transient set of card ids with a running start saga, threaded
 * in so this function stays pure — it reads the set, it does not own or mutate it.
 * @see docs/ARCHITECTURE.md#linear-sync
 */
export function reconcile(
  issues: SourceIssue[],
  current: Map<string, Card>,
  inFlightStartIds: ReadonlySet<string> = new Set(),
  sourceId: string = "linear",
): ReconcileResult {
  const seen = new Set(issues.map((i) => i.id));
  const upserts: Card[] = [];
  const reappearedIds: string[] = [];

  for (const issue of issues) {
    const existing = current.get(issue.id);
    if (!existing) {
      upserts.push(newTodoCard(issue, sourceId));
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
