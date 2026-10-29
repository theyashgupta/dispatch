import type { Card, Item } from "./types.js";

export type PrStateText =
  | "Draft"
  | "Review requested from me"
  | "Changes requested"
  | "Approved"
  | "Open";

export type PrChecksText = "pass" | "fail" | "pending" | "";

export type PrMergeableText = "mergeable" | "conflicting" | "unknown";

export interface PrRow {
  key: string;
  owner: string;
  name: string;
  repo: string;
  number: number;
  title: string;
  author: string;
  authorAvatar: string;
  state: PrStateText;
  checks: PrChecksText;
  mergeable: PrMergeableText;
  createdAt: string;
  reviewRequestedFromMe: boolean;
  time: string;
  unread: boolean;
  url: string;
  itemId?: string;
  cardId?: string;
}

export interface PrFilters {
  mine: boolean;
  reviewRequested: boolean;
  author: string;
  repo: string;
}

export const NO_PR_FILTERS: PrFilters = {
  mine: false,
  reviewRequested: false,
  author: "",
  repo: "",
};

const PR_URL = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)\/?$/;

const CHECKS = new Set<string>(["pass", "fail", "pending"]);

const AVATAR_HOST_PREFIX = "https://avatars.githubusercontent.com/";

function avatarOf(value: string | undefined): string {
  return value?.startsWith(AVATAR_HOST_PREFIX) ? value : "";
}

function mergeableOf(value: string | undefined): PrMergeableText {
  if (value === "MERGEABLE") return "mergeable";
  if (value === "CONFLICTING") return "conflicting";
  return "unknown";
}

export function prStateText(input: {
  draft: boolean;
  reviewRequestedFromMe: boolean;
  reviewDecision: string;
}): PrStateText {
  if (input.draft) return "Draft";
  if (input.reviewRequestedFromMe) return "Review requested from me";
  if (input.reviewDecision === "CHANGES_REQUESTED") return "Changes requested";
  if (input.reviewDecision === "APPROVED") return "Approved";
  return "Open";
}

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

export function prUrl(owner: string, name: string, number: number): string {
  return `https://github.com/${owner}/${name}/pull/${number}`;
}

/** The local branch a review worktree holds for a pull request. */
export function reviewBranch(number: number): string {
  return `review/pr-${number}`;
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
 * The done GitHub items a card holds, which the shared item hook leaves out.
 *
 * @remarks Review marks the pull request item done, and the Pull requests page and the review card
 * header still read its state and checks.
 */
export function heldPrItems(items: readonly Item[]): Item[] {
  return items.filter(
    (item) =>
      item.source === "github" &&
      item.state === "done" &&
      item.cardId !== undefined,
  );
}

/**
 * Build one row per GitHub item and per open pull request a Dispatch session opened.
 *
 * @remarks A session PR that GitHub also returned merges into the item's row and sets its card,
 * so a PR never shows twice. A done item shows unless it has no holding card or `cards` holds that
 * card as done, so a card on another board keeps its row, and a review card whose item is gone
 * keeps a row of its own. Merged and closed session PRs are left out, and a URL that is not a
 * github.com pull request is skipped.
 */
export function buildPrRows(
  items: readonly Item[],
  cards: readonly Card[],
): PrRow[] {
  const rows = new Map<string, PrRow>();
  const doneCards = new Set(
    cards.filter((card) => card.column === "done").map((card) => card.id),
  );
  for (const item of items) {
    if (item.source !== "github") continue;
    if (
      item.state === "done" &&
      (item.cardId === undefined || doneCards.has(item.cardId))
    )
      continue;
    const [owner = "", name = ""] = (item.meta.repo ?? "").split("/");
    const number = Number(item.meta.number);
    if (!owner || !name || !Number.isInteger(number)) continue;
    const draft = item.meta.draft === "true";
    const reviewRequestedFromMe =
      item.meta.reviewRequestedFromMe === "true" ||
      item.meta.category === "review";
    const checks = item.meta.checks ?? "";
    rows.set(item.id, {
      key: item.id,
      owner,
      name,
      repo: `${owner}/${name}`,
      number,
      title: item.title,
      author: item.meta.author ?? "",
      authorAvatar: avatarOf(item.meta.authorAvatar),
      state: prStateText({
        draft,
        reviewRequestedFromMe,
        reviewDecision: item.meta.reviewDecision ?? "",
      }),
      checks: CHECKS.has(checks) ? (checks as PrChecksText) : "",
      mergeable: mergeableOf(item.meta.mergeable),
      createdAt: item.meta.createdAt || item.createdAt,
      reviewRequestedFromMe,
      time: item.createdAt,
      unread: item.state === "unread",
      url: item.url ?? prUrl(owner, name, number),
      itemId: item.id,
      ...(item.cardId ? { cardId: item.cardId } : {}),
    });
  }
  for (const card of cards) {
    const review = card.reviewPr;
    if (review && card.column !== "done") {
      const [owner = "", name = ""] = review.repo.split("/");
      const key = prKey(owner, name, review.number);
      if (owner && name && !rows.has(key)) {
        rows.set(key, {
          key,
          owner,
          name,
          repo: review.repo,
          number: review.number,
          title: card.title,
          author: "",
          authorAvatar: "",
          state: "Open",
          checks: "",
          mergeable: "unknown",
          createdAt: card.updatedAt,
          reviewRequestedFromMe: false,
          time: card.updatedAt,
          unread: false,
          url: review.url,
          cardId: card.id,
        });
      }
    }
  }
  for (const card of cards) {
    for (const pr of card.prs ?? []) {
      if (pr.state !== "open") continue;
      const parsed = parsePrUrl(pr.url);
      if (!parsed) continue;
      const key = prKey(parsed.owner, parsed.name, parsed.number);
      const existing = rows.get(key);
      if (existing) {
        rows.set(key, { ...existing, cardId: card.id });
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
        authorAvatar: "",
        state: pr.isDraft ? "Draft" : "Open",
        checks: pr.ci ?? "",
        mergeable: "unknown",
        createdAt: card.updatedAt,
        reviewRequestedFromMe: false,
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

export function prFilterOptions(
  rows: readonly PrRow[],
  field: "author" | "repo",
): string[] {
  return [...new Set(rows.map((row) => row[field]).filter(Boolean))].sort();
}

/**
 * Narrow the rows by every filter that is set.
 *
 * @remarks
 * Mine compares the author with the GitHub login without case, because GitHub logins are
 * case-insensitive. With no known login it keeps no row.
 */
export function filterPrRows(
  rows: readonly PrRow[],
  filters: PrFilters,
  login: string | null,
): PrRow[] {
  const me = login?.toLowerCase() ?? null;
  return rows.filter(
    (row) =>
      (!filters.mine ||
        (me !== null &&
          row.author !== "" &&
          row.author.toLowerCase() === me)) &&
      (!filters.reviewRequested || row.reviewRequestedFromMe) &&
      (filters.author === "" || row.author === filters.author) &&
      (filters.repo === "" || row.repo === filters.repo),
  );
}
