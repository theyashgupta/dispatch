import type { Card, ReconcileResult, SourceIssue } from "../../shared/types.js";

/** Build a fresh Inbox card for a newly-seen source issue, stamped with its origin source. */
function newInboxCard(issue: SourceIssue, sourceId: string): Card {
  return {
    id: issue.id,
    issueId: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    url: issue.url,
    description: issue.description,
    priority: issue.priority,
    column: "inbox",
    updatedAt: issue.updatedAt,
    project: issue.project ?? undefined,
    goneFromLinear: false,
    source: sourceId,
  };
}

/** CR-01 predicate: a start saga is in flight for the card, or it already carries provisioning/session state from one. Exported so `adoptLinearIdentity`'s poll-race dedup applies the SAME removal guard reconcile does. */
export function isStartingCard(
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
 *  - Returned issue with no existing card -> upsert a NEW Inbox card stamped with `sourceId`
 *    (SYNC-01) — new tickets land in Inbox, never directly in To Do.
 *  - Returned issue whose card is in To Do OR Inbox -> upsert an in-place refresh of
 *    identifier/title/url/description/priority/updatedAt/project, clearing goneFromLinear
 *    (SYNC-02, 50-IN-04) — ONE widened rule, not a separate branch, so promoting a card to To Do
 *    simply changes which of the two columns keeps receiving refreshes. Identifier is included so
 *    a Linear team move (which changes the ticket's identifier prefix) is reflected on refresh.
 *  - Returned issue whose card is PAST To Do/Inbox -> NOT included in upserts; the poller never
 *    touches cards past that point (SYNC-02). Exception: a card currently flagged goneFromLinear
 *    emits a flag-only correction via `reappearedIds` — goneFromLinear is poller-owned derived
 *    state, not user board state, so clearing it does not violate the rule.
 *  - Current card whose issue is absent from the result: in To Do OR Inbox -> removeIds (SYNC-03:
 *    removed immediately, same as a vanished To Do ticket — Inbox does NOT inherit gone-flagging);
 *    past that point -> goneIds (kept, flagged goneFromLinear). CR-01 carve-out: a To Do card with
 *    a start saga in flight (or already carrying provisioning/session state from one) is NEVER
 *    removed, only flagged — removing it mid-saga would orphan a live session and its worktrees
 *    with no card to reach them. An Inbox card is structurally never mid-saga (no session start is
 *    reachable from Inbox), so the carve-out is a harmless no-op for it, not a special case.
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
      upserts.push(newInboxCard(issue, sourceId));
      continue;
    }
    if (existing.groupId != null) {
      upserts.push({
        ...existing,
        identifier: issue.identifier,
        title: issue.title,
        url: issue.url,
        description: issue.description,
        priority: issue.priority,
        updatedAt: issue.updatedAt,
        project: issue.project ?? undefined,
        goneFromLinear: false,
      });
    } else if (existing.column === "todo" || existing.column === "inbox") {
      upserts.push({
        ...existing,
        identifier: issue.identifier,
        title: issue.title,
        url: issue.url,
        description: issue.description,
        priority: issue.priority,
        updatedAt: issue.updatedAt,
        project: issue.project ?? undefined,
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
    if (
      card.groupId == null &&
      (card.column === "todo" || card.column === "inbox") &&
      !isStartingCard(card, inFlightStartIds)
    ) {
      removeIds.push(card.id);
    } else {
      goneIds.push(card.id);
    }
  }

  return { upserts, removeIds, goneIds, reappearedIds };
}
