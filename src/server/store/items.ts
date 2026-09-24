import type {
  Card,
  Item,
  SettableItemState,
  SourceKind,
} from "../../shared/types.js";

export interface ItemUpsertOptions {
  source: string;
  kind: SourceKind;
  partial: boolean;
  now: string;
}

export interface ItemUpsertResult {
  upserts: Item[];
  counts: { inserted: number; updated: number; resolved: number };
}

/**
 * Present an expired snooze as unread.
 *
 * @remarks The read path never mutates, so this runs on every read and again inside every item
 * mutator, which is what persists the wake on the next write that touches the row.
 */
export function wakeItem(item: Item, now: string): Item {
  if (item.state !== "snoozed") return item;
  if (item.snoozedUntil !== undefined && item.snoozedUntil > now) return item;
  return withState(item, "unread");
}

/** A copy of the item in a non-snoozed state, with any snooze time dropped. */
export function withState(item: Item, state: SettableItemState): Item {
  const next: Item = { ...item, state };
  delete next.snoozedUntil;
  return next;
}

/**
 * Compute the rows one source poll changes.
 *
 * @remarks An existing row keeps state, snoozedUntil and cardId and merges meta with the connector's
 * keys winning; a complete snapshot pull marks the source's missing rows done; an append or partial
 * pull never does.
 */
export function applyItemUpserts(
  existing: ReadonlyMap<string, Item>,
  incoming: readonly Item[],
  opts: ItemUpsertOptions,
): ItemUpsertResult {
  const upserts: Item[] = [];
  const counts = { inserted: 0, updated: 0, resolved: 0 };
  const latest = new Map(incoming.map((i) => [i.id, i]));
  for (const next of latest.values()) {
    const prior = existing.get(next.id);
    if (!prior) {
      const fresh: Item = { ...next };
      delete fresh.cardId;
      upserts.push(fresh);
      counts.inserted += 1;
      continue;
    }
    const kept = wakeItem(prior, opts.now);
    const merged: Item = {
      ...kept,
      type: next.type,
      title: next.title,
      snippet: next.snippet,
      url: next.url,
      priority: next.priority,
      createdAt: next.createdAt,
      meta: { ...kept.meta, ...next.meta },
    };
    if (JSON.stringify(merged) === JSON.stringify(prior)) continue;
    upserts.push(merged);
    counts.updated += 1;
  }
  if (opts.kind === "snapshot" && !opts.partial) {
    for (const item of existing.values()) {
      if (item.source !== opts.source || latest.has(item.id)) continue;
      if (item.state === "done") continue;
      upserts.push(withState(item, "done"));
      counts.resolved += 1;
    }
  }
  return { upserts, counts };
}

/** The wire copy of an item: every field named, so a future field stays off the wire until listed. */
export function redactItem(item: Item): Item {
  return {
    id: item.id,
    source: item.source,
    type: item.type,
    title: item.title,
    snippet: item.snippet,
    ...(item.url !== undefined ? { url: item.url } : {}),
    createdAt: item.createdAt,
    priority: item.priority,
    state: item.state,
    ...(item.snoozedUntil !== undefined
      ? { snoozedUntil: item.snoozedUntil }
      : {}),
    meta: { ...item.meta },
    ...(item.cardId !== undefined ? { cardId: item.cardId } : {}),
  };
}

export const ITEM_TITLE_MAX = 300;
export const ITEM_DESCRIPTION_MAX = 20000;

/**
 * Build the local Inbox card a promoted item becomes.
 *
 * @remarks The description is the snippet, the source link and one list line per meta pair, so the
 * card keeps everything the connector knew; both caps match the create-ticket route's limits.
 */
export function buildPromotedCard(
  item: Item,
  identifier: string,
  now: string,
): Card {
  const parts = [item.snippet.trim()];
  if (item.url !== undefined) parts.push(`Source: ${item.url}`);
  const metaLines = Object.entries(item.meta).map(([k, v]) => `- ${k}: ${v}`);
  if (metaLines.length > 0) parts.push(metaLines.join("\n"));
  const description = parts
    .filter((p) => p !== "")
    .join("\n\n")
    .slice(0, ITEM_DESCRIPTION_MAX);
  return {
    id: identifier,
    issueId: item.id,
    identifier,
    title: item.title.trim().slice(0, ITEM_TITLE_MAX),
    description: description === "" ? null : description,
    priority: 0,
    column: "inbox",
    updatedAt: now,
    source: "local",
  };
}
