import type { Config } from "../../shared/types.js";
import { store } from "../store/boardStore.js";
import type { LinearIssue } from "../store/mapping.js";

const LINEAR_GRAPHQL_URL = "https://api.linear.app/graphql";
const DEFAULT_POLL_INTERVAL_MS = 60_000;
const MAX_BACKOFF_MS = 15 * 60_000;
const MAX_PAGES = 20;

const BOARD_QUERY = `
query Board($after: String) {
  viewer {
    assignedIssues(
      first: 100
      after: $after
      filter: { state: { type: { eq: "unstarted" } } }
      orderBy: updatedAt
    ) {
      nodes {
        id
        identifier
        title
        url
        description
        priority
        updatedAt
        state { id name type }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;

interface IssueNode {
  id: string;
  identifier: string;
  title: string;
  url: string;
  description: string | null;
  priority: number;
  updatedAt: string;
}

/** Thrown when Linear responds with a RATELIMITED code so the loop can back off instead of crash. */
class RateLimitedError extends Error {
  constructor() {
    super("Linear API RATELIMITED");
    this.name = "RateLimitedError";
  }
}

/**
 * Fetch one page of assigned unstarted issues. Throws RateLimitedError on a RATELIMITED response
 * (HTTP 400 with the code in the body) and a plain Error on any other failure. The API key is
 * passed raw in the Authorization header (assumption A4 — no "Bearer" prefix) and never logged.
 */
async function fetchPage(
  apiKey: string,
  after: string | null,
): Promise<{
  nodes: IssueNode[];
  hasNextPage: boolean;
  endCursor: string | null;
}> {
  const res = await fetch(LINEAR_GRAPHQL_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: apiKey },
    body: JSON.stringify({ query: BOARD_QUERY, variables: { after } }),
  });

  let json: unknown;
  try {
    json = await res.json();
  } catch (err) {
    throw new Error(
      `Linear response was not JSON (HTTP ${res.status}): ${(err as Error).message}`,
    );
  }

  const body = json as {
    errors?: Array<{ message?: string; extensions?: { code?: string } }>;
    data?: {
      viewer?: {
        assignedIssues?: {
          nodes?: IssueNode[];
          pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
        };
      };
    };
  };

  if (body.errors?.length) {
    if (body.errors.some((e) => e.extensions?.code === "RATELIMITED")) {
      throw new RateLimitedError();
    }
    const codes = body.errors
      .map((e) => e.extensions?.code ?? "UNKNOWN")
      .join(", ");
    throw new Error(`Linear GraphQL errors (HTTP ${res.status}): ${codes}`);
  }

  if (!res.ok) {
    throw new Error(`Linear HTTP ${res.status}`);
  }

  const conn = body.data?.viewer?.assignedIssues;
  if (!conn || !Array.isArray(conn.nodes)) {
    throw new Error(
      `Linear response missing assignedIssues connection (HTTP ${res.status})`,
    );
  }
  return {
    nodes: conn.nodes,
    hasNextPage: conn.pageInfo?.hasNextPage ?? false,
    endCursor: conn.pageInfo?.endCursor ?? null,
  };
}

/**
 * Walk the cursor while hasNextPage (defensive; assigned-unstarted sets rarely exceed one page).
 * `truncated` is true whenever the last fetched page still reported hasNextPage — whether the
 * MAX_PAGES cap was exhausted or the cursor was missing (contract violation). The list is then
 * PARTIAL, and absence from it means nothing (removal/gone decisions must be skipped that cycle,
 * or every issue beyond the cap would be treated as disappeared and mass-removed/flagged).
 */
async function fetchAllIssues(
  apiKey: string,
): Promise<{ issues: LinearIssue[]; truncated: boolean }> {
  const nodes: IssueNode[] = [];
  let after: string | null = null;
  let lastHasNextPage = false;
  for (let page = 0; page < MAX_PAGES; page++) {
    const {
      nodes: pageNodes,
      hasNextPage,
      endCursor,
    } = await fetchPage(apiKey, after);
    nodes.push(...pageNodes);
    lastHasNextPage = hasNextPage;
    if (!hasNextPage || endCursor === null) break;
    after = endCursor;
  }
  const issues = nodes.map((n) => ({
    id: n.id,
    identifier: n.identifier,
    title: n.title,
    url: n.url,
    description: n.description ?? null,
    priority: n.priority,
    updatedAt: n.updatedAt,
  }));
  return { issues, truncated: lastHasNextPage };
}

/**
 * Start the poll loop. Runs one poll immediately, then reschedules itself: the base interval on a
 * healthy cycle, or an exponentially-backed-off delay after a RATELIMITED response. A self-
 * rescheduling timer (rather than setInterval) guarantees polls never overlap and lets the delay
 * vary for backoff. Fire-and-forget: startPoller returns immediately.
 * @remarks SYNC-01: the I/O half only — it fetches assigned-unstarted issues and hands the raw
 * list to the single-writer store, which runs the pure reconcile() inside its mutation queue. It
 * never sorts, never touches cards past To Do, and keeps last-known-good on any error/RATELIMITED.
 * @see docs/ARCHITECTURE.md#linear-sync
 */
export function startPoller(config: Config): void {
  const apiKey = config.linearApiKey;
  const baseIntervalMs = config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  let backoffMs = baseIntervalMs;

  async function pollOnce(): Promise<void> {
    try {
      const { issues, truncated } = await fetchAllIssues(apiKey);
      if (truncated) {
        console.warn(
          `[poller] partial Linear pull (pages remained beyond the ${MAX_PAGES}-page cap or the cursor was missing) — applying upserts only, skipping removals/gone-flags this cycle.`,
        );
      }
      await store.applyIssues(issues, new Date().toISOString(), {
        partial: truncated,
      });
      backoffMs = baseIntervalMs;
      scheduleNext(baseIntervalMs);
    } catch (err) {
      if (err instanceof RateLimitedError) {
        backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
        console.warn(
          `[poller] Linear rate-limited — backing off ${Math.round(backoffMs / 1000)}s, keeping last-known-good.`,
        );
        scheduleNext(backoffMs);
      } else {
        console.error(
          `[poller] poll failed — keeping last-known-good: ${(err as Error).message}`,
        );
        scheduleNext(baseIntervalMs);
      }
    }
  }

  function scheduleNext(delayMs: number): void {
    const timer = setTimeout(() => void pollOnce(), delayMs);
    timer.unref?.();
  }

  void pollOnce();
}
