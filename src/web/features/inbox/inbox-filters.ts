import type { Card, FilterOption } from "../../../shared/types.js";

export function inboxProjectOptions(cards: Card[]): FilterOption[] {
  const byId = new Map<string, string>();
  for (const c of cards) {
    if (c.project) byId.set(c.project.id, c.project.name);
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

export function inboxSourceOptions(cards: Card[]): FilterOption[] {
  const ids = new Set<string>();
  for (const c of cards) ids.add(c.source ?? "linear");
  return [...ids]
    .map((id) => ({ id, label: id.charAt(0).toUpperCase() + id.slice(1) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export function matchesSource(card: Card, ids: string[]): boolean {
  if (ids.length === 0) return true;
  return ids.includes(card.source ?? "linear");
}
