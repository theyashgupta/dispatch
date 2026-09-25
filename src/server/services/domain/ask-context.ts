import type { Card, Item } from "../../../shared/types.js";

const RECORD_LINES = 250;
const SESSION_LINES = 20;
const SNIPPET_CHARS = 280;

interface AskContextMeta {
  syncedAt: string | null;
  enabledSources: string[];
}

interface Ranked {
  line: string;
  at: string;
  active: boolean;
}

function snippet(text: string | null | undefined): string {
  return (text ?? "").slice(0, SNIPPET_CHARS);
}

function toLine(record: object): string {
  return JSON.stringify(record).replaceAll("<", "\\u003c");
}

function newestFirst(a: Ranked, b: Ranked): number {
  return b.at.localeCompare(a.at);
}

function rankCard(card: Card): Ranked {
  const record = {
    kind: "card",
    identifier: card.identifier,
    title: card.title,
    column: card.column,
    source: card.source ?? "linear",
    priority: card.priority,
    updatedAt: card.updatedAt,
    project: card.project?.name ?? null,
    statusReason: card.statusReason ?? null,
    lastMarker: card.lastMarker ?? null,
    sessionLost: card.sessionLost ?? false,
    snippet: snippet(card.description),
    prs: (card.prs ?? []).map((pr) => ({
      number: pr.number,
      state: pr.state,
      ci: pr.ci,
      isDraft: pr.isDraft,
    })),
  };
  return {
    line: toLine(record),
    at: card.updatedAt,
    active: card.column !== "done",
  };
}

function rankItem(item: Item): Ranked {
  const record = {
    kind: "item",
    id: item.id,
    source: item.source,
    type: item.type,
    title: item.title,
    snippet: snippet(item.snippet),
    priority: item.priority,
    state: item.state,
    createdAt: item.createdAt,
    snoozedUntil: item.snoozedUntil ?? null,
    cardId: item.cardId ?? null,
  };
  return {
    line: toLine(record),
    at: item.createdAt,
    active: item.state !== "done",
  };
}

function sessionLines(cards: readonly Card[]): string[] {
  const sessions = cards.flatMap((card) =>
    (card.sessions ?? []).map((session) => ({ card, session })),
  );
  sessions.sort((a, b) =>
    b.session.updatedAt.localeCompare(a.session.updatedAt),
  );
  return sessions.slice(0, SESSION_LINES).map(({ card, session }) =>
    toLine({
      kind: "session",
      identifier: card.identifier,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      branch: session.branch ?? null,
      account: session.claudeAccountId ?? null,
      lost: session.tmuxSession == null,
      active: session.id === card.activeSessionId,
      prs: session.prs?.length ?? 0,
    }),
  );
}

/**
 * Build the JSON lines Ask sends to Claude, one allow-listed record per line.
 *
 * @remarks Every non-done card and item is kept before any done one, so a busy history never
 * pushes active work out of the 250 line cap. Records are built key by key so a new secret field
 * can never leak in, and `<` is escaped so a title cannot close the prompt's data fence.
 */
export function buildAskContext(
  cards: readonly Card[],
  items: readonly Item[],
  meta: AskContextMeta,
  now: Date,
): string[] {
  const ranked = [...cards.map(rankCard), ...items.map(rankItem)];
  const active = ranked.filter((r) => r.active).sort(newestFirst);
  const done = ranked.filter((r) => !r.active).sort(newestFirst);
  const records = [...active, ...done].slice(0, RECORD_LINES);
  const sync = toLine({
    kind: "sync",
    syncedAt: meta.syncedAt,
    enabledSources: meta.enabledSources,
    now: now.toISOString(),
  });
  return [...records.map((r) => r.line), ...sessionLines(cards), sync];
}
