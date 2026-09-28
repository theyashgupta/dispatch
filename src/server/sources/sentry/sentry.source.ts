import type {
  FilterCapabilities,
  FilterOption,
  Item,
  SourceCredential,
  SourceIssue,
} from "../../../shared/types.js";
import { RateLimited, type TicketSource } from "../ticket.source.js";

export const SENTRY_API_URL =
  process.env.DISPATCH_SENTRY_API_URL ?? "https://sentry.io";

const SENTRY_TIMEOUT_MS = 30_000;

const SNIPPET_MAX = 280;

const PAGE_SIZE = 100;

const ORG_CAP = 10;

const ISSUE_QUERIES = [
  {
    category: "assigned",
    type: "error_assigned",
    query: "is:unresolved assigned:me",
  },
  { category: "unresolved", type: "error", query: "is:unresolved" },
] as const;

type IssueQuery = (typeof ISSUE_QUERIES)[number];

export class SentryAuthError extends Error {
  constructor() {
    super("Sentry rejected the token");
    this.name = "SentryAuthError";
  }
}

export class SentryRequestError extends Error {
  constructor(readonly status: number) {
    super(`Sentry answered HTTP ${status}`);
    this.name = "SentryRequestError";
  }
}

interface RawSentryOrg {
  slug: string;
  links?: { regionUrl?: string | null } | null;
}

export interface RawSentryIssue {
  id: string;
  title: string;
  culprit?: string | null;
  permalink?: string | null;
  shortId?: string | null;
  level?: string | null;
  count?: string | number | null;
  userCount?: number | null;
  lastSeen?: string | null;
  project?: { slug?: string | null } | null;
}

/**
 * Send one authenticated Sentry API request and turn every non-2xx answer into a typed error.
 *
 * @remarks The token only ever reaches the Authorization header and errors carry only the status,
 * never a header or a raw body. A network failure propagates as the fetch TypeError so the poll
 * loop reports the board-wide unreachable state.
 */
export async function sentryRequest(
  token: string,
  base: string,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<Response> {
  const res = await fetch(`${base}${path}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "User-Agent": "dispatch",
      ...(init.body !== undefined
        ? { "Content-Type": "application/json" }
        : {}),
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    signal: AbortSignal.timeout(SENTRY_TIMEOUT_MS),
  });
  if (res.ok) return res;
  if (res.status === 401) throw new SentryAuthError();
  if (
    res.status === 429 ||
    res.headers.get("x-sentry-rate-limit-remaining") === "0"
  ) {
    throw new RateLimited();
  }
  throw new SentryRequestError(res.status);
}

/**
 * The origin an organization's scoped calls go to, or null when its region URL is not allowed.
 *
 * @remarks Only an https origin on sentry.io or one of its subdomains, or the configured base
 * itself, may receive the token; anything else falls back to the base URL.
 */
export function allowedRegion(regionUrl: unknown): string | null {
  if (typeof regionUrl !== "string" || regionUrl === "") return null;
  let url: URL;
  try {
    url = new URL(regionUrl);
  } catch {
    return null;
  }
  if (url.pathname !== "/" && url.pathname !== "") return null;
  if (url.origin === new URL(SENTRY_API_URL).origin) return url.origin;
  const host = url.hostname;
  const onSentry = host === "sentry.io" || host.endsWith(".sentry.io");
  return url.protocol === "https:" && onSentry ? url.origin : null;
}

/** Rank an issue so every assigned issue sits above every organization-wide one. */
export function sentryPriority(
  level: string | null | undefined,
  category: IssueQuery["category"],
): number {
  const severe = level === "fatal" || level === "error";
  if (category === "assigned") return severe ? 100 : 75;
  return severe ? 50 : 25;
}

/** Turn one Sentry issue into a Dispatch item. */
export function sentryItem(
  org: string,
  region: string | null,
  raw: RawSentryIssue,
  query: IssueQuery,
): Item {
  const culprit = raw.culprit ?? "";
  return {
    id: `sentry:${raw.id}`,
    source: "sentry",
    type: query.type,
    title: raw.title,
    snippet: culprit.slice(0, SNIPPET_MAX),
    ...(raw.permalink && /^https?:\/\//i.test(raw.permalink)
      ? { url: raw.permalink }
      : {}),
    createdAt: raw.lastSeen ?? new Date(0).toISOString(),
    priority: sentryPriority(raw.level, query.category),
    state: "unread",
    meta: {
      org,
      ...(region ? { regionUrl: region } : {}),
      project: raw.project?.slug ?? "",
      level: raw.level ?? "",
      count: String(raw.count ?? "0"),
      userCount: String(raw.userCount ?? 0),
      culprit,
      shortId: raw.shortId ?? "",
      category: query.category,
    },
  };
}

/** Whether a Link header announces another page with results. */
function hasNextPage(link: string | null): boolean {
  if (!link) return false;
  return link
    .split(",")
    .some((part) => /rel="next"/.test(part) && /results="true"/.test(part));
}

/** Run one issues query for an organization; a 403 answers null so the caller skips the org. */
async function queryIssues(
  token: string,
  base: string,
  org: string,
  query: IssueQuery,
): Promise<{ issues: RawSentryIssue[]; more: boolean } | null> {
  const params = new URLSearchParams({
    query: query.query,
    statsPeriod: "14d",
    limit: String(PAGE_SIZE),
  });
  try {
    const res = await sentryRequest(
      token,
      base,
      `/api/0/organizations/${encodeURIComponent(org)}/issues/?${params.toString()}`,
    );
    const issues = (await res.json()) as RawSentryIssue[];
    return {
      issues,
      more: issues.length >= PAGE_SIZE || hasNextPage(res.headers.get("link")),
    };
  } catch (err) {
    if (err instanceof SentryRequestError && err.status === 403) return null;
    throw err;
  }
}

/** List the organizations a token sees, on the base URL. */
async function fetchSentryOrgs(token: string): Promise<RawSentryOrg[]> {
  const res = await sentryRequest(
    token,
    SENTRY_API_URL,
    "/api/0/organizations/",
  );
  return (await res.json()) as RawSentryOrg[];
}

/**
 * Read the organizations behind a token as a short account label, for the connection card.
 *
 * @remarks Resolves null only when Sentry rejects the token; every other failure throws so an
 * outage is never reported as a bad token. The label names up to three organizations and counts the rest.
 */
export async function fetchSentryAccount(
  token: string,
): Promise<{ account?: string } | null> {
  let orgs: RawSentryOrg[];
  try {
    orgs = await fetchSentryOrgs(token);
  } catch (err) {
    if (err instanceof SentryAuthError) return null;
    throw err;
  }
  if (orgs.length === 0) return {};
  const named = orgs
    .slice(0, 3)
    .map((o) => o.slug)
    .join(", ");
  return { account: orgs.length > 3 ? `${named} +${orgs.length - 3}` : named };
}

/**
 * Read every organization's unresolved issues, assigned first, and decide whether the pull was complete.
 *
 * @remarks An issue an earlier query or organization returned is not repeated. The pull is partial
 * when a query fills a page or announces another, when the organization cap cuts organizations, or
 * when an organization refuses access; a partial pull must never resolve items it did not see.
 */
async function pullSentryIssues(
  token: string,
): Promise<{ items: Item[]; partial: boolean }> {
  const orgs = await fetchSentryOrgs(token);
  let partial = orgs.length > ORG_CAP;
  const seen = new Set<string>();
  const items: Item[] = [];
  for (const org of orgs.slice(0, ORG_CAP)) {
    const region = allowedRegion(org.links?.regionUrl);
    const base = region ?? SENTRY_API_URL;
    for (const query of ISSUE_QUERIES) {
      const page = await queryIssues(token, base, org.slug, query);
      if (!page) {
        partial = true;
        break;
      }
      if (page.more) partial = true;
      for (const raw of page.issues) {
        if (seen.has(raw.id)) continue;
        seen.add(raw.id);
        items.push(sentryItem(org.slug, region, raw, query));
      }
    }
  }
  return { items, partial };
}

export class SentrySource implements TicketSource {
  readonly id = "sentry";
  readonly kind = "snapshot" as const;
  readonly vaultKeys: readonly string[] = ["SENTRY_TOKEN"];
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
    if (!credential) throw new Error("no Sentry credential is available");
    const { items, partial } = await pullSentryIssues(credential.token);
    return { issues: [], items, truncated: partial };
  }

  listOptions(): Promise<{ options: FilterOption[]; truncated: boolean }> {
    return Promise.resolve({ options: [], truncated: false });
  }

  countMatches(): Promise<{ count: number; more: boolean }> {
    return Promise.resolve({ count: 0, more: false });
  }
}
