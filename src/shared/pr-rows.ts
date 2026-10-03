import type { Card, Item } from "./types.js";

export type PrCategory = "review" | "mention" | "assigned" | "yours";

export type PrGroupBy = "repo" | "author" | "type";

export interface PrRow {
  key: string;
  owner: string;
  name: string;
  repo: string;
  number: number;
  title: string;
  author: string;
  category: PrCategory;
  yours: boolean;
  draft: boolean;
  time: string;
  unread: boolean;
  url: string;
  itemId?: string;
  cardId?: string;
}

export interface PrGroup {
  key: string;
  label: string;
  rows: PrRow[];
}

export const CATEGORY_LABEL: Record<PrCategory, string> = {
  review: "Review requested",
  mention: "Mentioned",
  assigned: "Assigned",
  yours: "Yours",
};

const PR_URL = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)\/?$/;

const CATEGORIES = new Set<string>(["review", "mention", "assigned"]);

/**
 * Parse a GitHub pull request URL into owner, name and number, or null.
 *
 * @remarks A `.` or `..` owner or name is refused, so the URL cannot change an API path.
 */
export function parsePrUrl(
  url: string,
): { owner: string; name: string; number: number } | null {
  const m = PR_URL.exec(url);
  if (!m || [m[1], m[2]].some((part) => part === "." || part === "..")) {
    return null;
  }
  return { owner: m[1], name: m[2], number: Number(m[3]) };
}

/** The row key a pull request has on this page and in the route. */
export function prKey(owner: string, name: string, number: number): string {
  return `github:${owner}/${name}#${number}`;
}

/**
 * Parse a row key from `prKey` back into owner, name and number, or null.
 *
 * @remarks A `.` or `..` owner or name is refused, so the key cannot change an API path.
 */
export function parsePrKey(
  key: string,
): { owner: string; name: string; number: number } | null {
  const m = /^github:([^/]+)\/([^#]+)#(\d+)$/.exec(key);
  if (!m || [m[1], m[2]].some((part) => part === "." || part === "..")) {
    return null;
  }
  return { owner: m[1], name: m[2], number: Number(m[3]) };
}

/**
 * Build one row per GitHub item and per open pull request a Dispatch session opened.
 *
 * @remarks A session PR that GitHub also returned merges into the item's row with the Yours flag,
 * so a PR never shows twice. Merged and closed session PRs are left out, and a URL that is not a
 * github.com pull request is skipped. Rows sort newest first.
 */
export function buildPrRows(
  items: readonly Item[],
  cards: readonly Card[],
): PrRow[] {
  const rows = new Map<string, PrRow>();
  for (const item of items) {
    if (item.source !== "github" || item.state === "done") continue;
    const [owner = "", name = ""] = (item.meta.repo ?? "").split("/");
    const number = Number(item.meta.number);
    if (!owner || !name || !Number.isInteger(number)) continue;
    const category = CATEGORIES.has(item.meta.category ?? "")
      ? (item.meta.category as PrCategory)
      : "review";
    rows.set(item.id, {
      key: item.id,
      owner,
      name,
      repo: `${owner}/${name}`,
      number,
      title: item.title,
      author: item.meta.author ?? "",
      category,
      yours: false,
      draft: item.meta.draft === "true",
      time: item.createdAt,
      unread: item.state === "unread",
      url: item.url ?? `https://github.com/${owner}/${name}/pull/${number}`,
      itemId: item.id,
    });
  }
  for (const card of cards) {
    for (const pr of card.prs ?? []) {
      if (pr.state !== "open") continue;
      const parsed = parsePrUrl(pr.url);
      if (!parsed) continue;
      const key = prKey(parsed.owner, parsed.name, parsed.number);
      const existing = rows.get(key);
      if (existing) {
        rows.set(key, { ...existing, yours: true, cardId: card.id });
        continue;
      }
      rows.set(key, {
        key,
        owner: parsed.owner,
        name: parsed.name,
        repo: `${parsed.owner}/${parsed.name}`,
        number: parsed.number,
        title: pr.title,
        author: "",
        category: "yours",
        yours: true,
        draft: pr.isDraft,
        time: card.updatedAt,
        unread: false,
        url: pr.url,
        cardId: card.id,
      });
    }
  }
  return [...rows.values()].sort(
    (a, b) => b.time.localeCompare(a.time) || a.key.localeCompare(b.key),
  );
}

/** Group rows by repository, author or type, keeping each group's rows in their incoming order. */
export function groupPrRows(rows: readonly PrRow[], by: PrGroupBy): PrGroup[] {
  const groups = new Map<string, PrGroup>();
  for (const row of rows) {
    const key =
      by === "repo" ? row.repo : by === "author" ? row.author : row.category;
    const label =
      by === "type"
        ? CATEGORY_LABEL[row.category]
        : by === "author" && row.author === ""
          ? "You"
          : key;
    const group = groups.get(key) ?? { key, label, rows: [] };
    group.rows.push(row);
    groups.set(key, group);
  }
  return [...groups.values()];
}
