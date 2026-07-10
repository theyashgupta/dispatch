import type { SourceIssue } from "../../../shared/types.js";
import { RateLimited, type TicketSource } from "../TicketSource.js";

const LINEAR_GRAPHQL_URL = "https://api.linear.app/graphql";
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

/**
 * Fetch one page of assigned unstarted issues. Throws the shared RateLimited sentinel on a
 * RATELIMITED response (HTTP 400 with the code in the body) and a plain Error on any other failure.
 * The API key is passed raw in the Authorization header (assumption A4 — no auth-scheme prefix) and
 * never logged.
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
      throw new RateLimited();
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
): Promise<{ issues: SourceIssue[]; truncated: boolean }> {
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
 * The Linear TicketSource: owns the GraphQL query, cursor paging, prefix-less auth, and RATELIMITED
 * detection for the assigned-unstarted board. Constructed once at boot with the resolved API key
 * (live filter re-read is a later concern); `fetch()` delegates to the verbatim paged fetch.
 */
export class LinearSource implements TicketSource {
  readonly id = "linear";

  constructor(private apiKey: string) {}

  fetch(): Promise<{ issues: SourceIssue[]; truncated: boolean }> {
    return fetchAllIssues(this.apiKey);
  }
}
