import type {
  Card,
  ReconcileResult,
  SourceIssue,
  TrackedRefresh,
} from "../../shared/types.js";

/** Build a fresh Inbox card for a newly-seen source issue, stamped with its origin source. */
function newInboxCard(issue: SourceIssue, sourceId: string): Card {
  return {
    id: issue.id,
    issueId: issue.id,
    column: "inbox",
    ...issueFields(issue),
    goneFromLinear: false,
    source: sourceId,
  };
}

/** The fields a poll copies from an issue onto a card in To Do or Inbox, or a grouped card. */
function issueFields(issue: SourceIssue) {
  return {
    identifier: issue.identifier,
    title: issue.title,
    url: issue.url,
    description: issue.description,
    priority: issue.priority,
    updatedAt: issue.updatedAt,
    project: issue.project ?? undefined,
    ...displayFields(issue),
  };
}

/** The Linear-owned display fields a poll may refresh on a card in any column. */
function displayFields(
  issue: SourceIssue,
): Pick<Card, "linearState" | "team" | "cycle" | "assignee" | "comments"> {
  return {
    linearState: issue.state,
    team: issue.team,
    cycle: issue.cycle,
    assignee: issue.assignee,
    comments: issue.comments,
  };
}

/**
 * Whether any Linear-owned display field differs between a card and a fresh issue.
 *
 * @remarks Compares JSON, which drops undefined keys; every stored value was built by the same
 * mapping, so key order matches, and a legacy row without a state id or color reads as changed.
 */
function displayFieldsChanged(card: Card, issue: SourceIssue): boolean {
  const { linearState, team, cycle, assignee, comments } = card;
  return (
    JSON.stringify({ linearState, team, cycle, assignee, comments }) !==
    JSON.stringify(displayFields(issue))
  );
}

/** Whether a card sits past To Do and Inbox, where a poll refreshes only its display fields. */
export function isPastTodo(card: Card): boolean {
  return card.column !== "todo" && card.column !== "inbox";
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
 *  - Returned issue (main or `tracked`) whose card is PAST To Do/Inbox -> display fields only.
 *  - Current card whose issue is absent from the result: in To Do OR Inbox -> removeIds (SYNC-03:
 *    removed immediately, same as a vanished To Do ticket — Inbox does NOT inherit gone-flagging);
 *    past that point -> goneIds only when `tracked` requested it by id and did not get it back
 *    (no `tracked` keeps the plain rule). CR-01 carve-out: a To Do card with
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
  tracked?: TrackedRefresh,
): ReconcileResult {
  const seen = new Set(issues.map((i) => i.id));
  const trackedById = new Map(
    (tracked?.issues ?? []).map((i) => [i.id, i] as const),
  );
  const upserts: Card[] = [];
  const reappearedIds: string[] = [];
  const refreshPastTodo = (existing: Card, issue: SourceIssue): void => {
    if (displayFieldsChanged(existing, issue)) {
      upserts.push({
        ...existing,
        ...displayFields(issue),
        goneFromLinear: false,
      });
    } else if (existing.goneFromLinear) {
      reappearedIds.push(existing.id);
    }
  };

  for (const issue of issues) {
    const existing = current.get(issue.id);
    if (!existing) {
      upserts.push(newInboxCard(issue, sourceId));
      continue;
    }
    if (existing.groupId != null || !isPastTodo(existing)) {
      upserts.push({
        ...existing,
        ...issueFields(issue),
        goneFromLinear: false,
      });
    } else {
      refreshPastTodo(existing, issue);
    }
  }

  const removeIds: string[] = [];
  const goneIds: string[] = [];
  for (const card of current.values()) {
    if (seen.has(card.issueId)) continue;
    if (!isPastTodo(card)) {
      if (card.groupId == null && !isStartingCard(card, inFlightStartIds)) {
        removeIds.push(card.id);
      } else {
        goneIds.push(card.id);
      }
      continue;
    }
    const trackedIssue = trackedById.get(card.issueId);
    if (trackedIssue) {
      refreshPastTodo(card, trackedIssue);
    } else if (!tracked || tracked.requested.has(card.issueId)) {
      goneIds.push(card.id);
    }
  }

  return { upserts, removeIds, goneIds, reappearedIds };
}
