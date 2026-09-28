import type {
  FilterCapabilities,
  FilterOption,
  Item,
  SourceCredential,
  SourceIssue,
} from "../../../shared/types.js";
import { RateLimited, type TicketSource } from "../ticket.source.js";

export const GITHUB_API_URL =
  process.env.DISPATCH_GITHUB_API_URL ?? "https://api.github.com";

const GITHUB_TIMEOUT_MS = 30_000;

const SNIPPET_MAX = 280;

const PAGE_SIZE = 100;

export const SEARCH_CATEGORIES = [
  {
    category: "review",
    type: "pr_review",
    query: "is:open is:pr review-requested:@me",
    priority: 75,
  },
  {
    category: "mention",
    type: "pr_mention",
    query: "is:open is:pr mentions:@me",
    priority: 50,
  },
  {
    category: "assigned",
    type: "pr_assigned",
    query: "is:open is:pr assignee:@me",
    priority: 50,
  },
] as const;

type Category = (typeof SEARCH_CATEGORIES)[number];

export class GitHubAuthError extends Error {
  constructor() {
    super("GitHub rejected the token");
    this.name = "GitHubAuthError";
  }
}

export class GitHubSsoError extends Error {
  constructor(readonly ssoUrl?: string) {
    super("GitHub requires SAML SSO authorization for this token");
    this.name = "GitHubSsoError";
  }
}

export class GitHubRequestError extends Error {
  constructor(
    readonly status: number,
    readonly providerMessage?: string,
  ) {
    super(`GitHub answered HTTP ${status}`);
    this.name = "GitHubRequestError";
  }
}

export interface RawSearchItem {
  number: number;
  title: string;
  body?: string | null;
  html_url: string;
  repository_url: string;
  user?: { login?: string } | null;
  draft?: boolean;
  updated_at: string;
}

export interface SearchResult {
  category: Category;
  total: number;
  incomplete: boolean;
  ssoPartial: boolean;
  items: RawSearchItem[];
}

/**
 * Send one authenticated GitHub API request and turn every non-2xx answer into a typed error.
 *
 * @remarks The token only ever reaches the Authorization header; error messages carry the status
 * and, for 405/409/422, GitHub's own message text, never a header or a raw body. A network failure
 * propagates as the fetch TypeError so the poll loop reports the board-wide unreachable state.
 */
export async function githubRequest(
  token: string,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<Response> {
  const res = await fetch(`${GITHUB_API_URL}${path}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "dispatch",
      ...(init.body !== undefined
        ? { "Content-Type": "application/json" }
        : {}),
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
  });
  if (res.ok) return res;
  if (res.status === 401) throw new GitHubAuthError();
  const sso = res.headers.get("x-github-sso") ?? "";
  if (res.status === 403 && sso.startsWith("required")) {
    throw new GitHubSsoError(/url=(\S+)/.exec(sso)?.[1]);
  }
  if (
    res.status === 429 ||
    (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0")
  ) {
    throw new RateLimited();
  }
  let message: string | undefined;
  if ([405, 409, 422].includes(res.status)) {
    const body = (await res.json().catch(() => null)) as {
      message?: unknown;
    } | null;
    if (typeof body?.message === "string") message = body.message;
  }
  throw new GitHubRequestError(res.status, message);
}

/** Split a search result's repository API URL into owner and name. */
function repoOf(repositoryUrl: string): { owner: string; name: string } | null {
  const m = /\/repos\/([^/]+)\/([^/]+)$/.exec(repositoryUrl);
  return m ? { owner: m[1], name: m[2] } : null;
}

/**
 * Turn the three search results into GitHub items and decide whether the pull was complete.
 *
 * @remarks Results arrive in category order and a PR an earlier category returned is not repeated,
 * so a review request that also mentions the user stays a review. The pull is partial when any
 * category has more than one page, reports incomplete results, or hides SSO-protected orgs; a
 * partial pull must never resolve items it did not see.
 */
export function mergeSearchResults(results: readonly SearchResult[]): {
  items: Item[];
  partial: boolean;
} {
  const seen = new Set<string>();
  const items: Item[] = [];
  for (const result of results) {
    for (const raw of result.items) {
      const repo = repoOf(raw.repository_url);
      if (!repo) continue;
      const key = `${repo.owner}/${repo.name}#${raw.number}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({
        id: `github:${key}`,
        source: "github",
        type: result.category.type,
        title: raw.title,
        snippet: (raw.body ?? "").trim().slice(0, SNIPPET_MAX),
        url: raw.html_url,
        createdAt: raw.updated_at,
        priority: result.category.priority,
        state: "unread",
        meta: {
          repo: `${repo.owner}/${repo.name}`,
          number: String(raw.number),
          author: raw.user?.login ?? "",
          draft: raw.draft === true ? "true" : "false",
          category: result.category.category,
        },
      });
    }
  }
  const partial = results.some(
    (r) => r.total > PAGE_SIZE || r.incomplete || r.ssoPartial,
  );
  return { items, partial };
}

/** Run one search category with the given token. */
async function search(
  token: string,
  category: Category,
): Promise<SearchResult> {
  const params = new URLSearchParams({
    q: category.query,
    per_page: String(PAGE_SIZE),
  });
  const res = await githubRequest(token, `/search/issues?${params.toString()}`);
  const body = (await res.json()) as {
    total_count?: number;
    incomplete_results?: boolean;
    items?: RawSearchItem[];
  };
  return {
    category,
    total: body.total_count ?? 0,
    incomplete: body.incomplete_results === true,
    ssoPartial: (res.headers.get("x-github-sso") ?? "").startsWith(
      "partial-results",
    ),
    items: body.items ?? [],
  };
}

/**
 * Read the login behind a token, for the connection card.
 *
 * @remarks Resolves null only when GitHub rejects the token; every other failure throws so an
 * outage is never reported as a bad token.
 */
export async function fetchGithubLogin(
  token: string,
): Promise<{ account?: string } | null> {
  try {
    const res = await githubRequest(token, "/user");
    const body = (await res.json()) as { login?: unknown };
    return typeof body.login === "string" ? { account: body.login } : {};
  } catch (err) {
    if (err instanceof GitHubAuthError) return null;
    throw err;
  }
}

export class GitHubSource implements TicketSource {
  readonly id = "github";
  readonly kind = "snapshot" as const;
  readonly vaultKeys: readonly string[] = ["GITHUB_TOKEN"];
  readonly capabilities: FilterCapabilities = { dimensions: [] };

  constructor(
    private resolveCredential: () => Promise<SourceCredential | null>,
    readonly pollIntervalMs: number,
  ) {}

  async fetch(): Promise<{
    issues: SourceIssue[];
    items: Item[];
    truncated: boolean;
  }> {
    const credential = await this.resolveCredential();
    if (!credential) throw new Error("no GitHub credential is available");
    const results: SearchResult[] = [];
    for (const category of SEARCH_CATEGORIES) {
      results.push(await search(credential.token, category));
    }
    const { items, partial } = mergeSearchResults(results);
    return { issues: [], items, truncated: partial };
  }

  listOptions(): Promise<{ options: FilterOption[]; truncated: boolean }> {
    return Promise.resolve({ options: [], truncated: false });
  }

  countMatches(): Promise<{ count: number; more: boolean }> {
    return Promise.resolve({ count: 0, more: false });
  }
}
