import type { Card, FilterOption } from "../../../shared/types.js";

export function inboxProjectOptions(cards: Card[]): FilterOption[] {
  const byId = new Map<string, string>();
  for (const c of cards) {
    if (c.column === "inbox" && c.project)
      byId.set(c.project.id, c.project.name);
  }
  return [...byId]
    .map(([id, label]) => ({ id, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export function matchesSearch(card: Card, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  return (
    card.title.toLowerCase().includes(q) ||
    card.identifier.toLowerCase().includes(q)
  );
}
