import type { SourceFilters, SourceIssue } from "../../../shared/types.js";
import {
  RateLimited,
  type FilterCapabilities,
  type FilterOption,
  type TicketSource,
} from "../TicketSource.js";
import { buildLinearQuery, type LinearIssueFilter } from "./filter.js";

const LINEAR_GRAPHQL_URL = "https://api.linear.app/graphql";
const MAX_PAGES = 20;
const PAGE_SIZE = 250;

const ISSUE_NODE_FIELDS =
  "id identifier title url description priority updatedAt state { id name type }";

/**
 * Build the paged board query for the active shape. `viewer.assignedIssues` keeps the implicit
 * assigned-to-me scope for the empty-assignee default (FILT-05); root `issues` is used only once an
 * explicit assignee multi-select forces it. The filter always crosses as the typed `$filter`
 * variable — user ids are never interpolated into the query text (tampering guard).
 */
function boardQuery(useViewerScope: boolean): string {
  const connection = `(first: ${PAGE_SIZE}, after: $after, filter: $filter, orderBy: updatedAt) { nodes { ${ISSUE_NODE_FIELDS} } pageInfo { hasNextPage endCursor } }`;
  return useViewerScope
    ? `query Board($after: String, $filter: IssueFilter) { viewer { assignedIssues${connection} } }`
    : `query Board($after: String, $filter: IssueFilter) { issues${connection} }`;
}

/**
 * Build the id-only count query for the active shape. Mirrors `boardQuery`'s scope choice so the
 * preview counts exactly what the poll would sync (Pitfall P2); a single 250-node page plus
 * `hasNextPage` yields an exact count or the "250+" cap.
 */
function countQuery(useViewerScope: boolean): string {
  const connection = `(first: ${PAGE_SIZE}, filter: $filter) { nodes { id } pageInfo { hasNextPage } }`;
  return useViewerScope
    ? `query Count($filter: IssueFilter) { viewer { assignedIssues${connection} } }`
    : `query Count($filter: IssueFilter) { issues${connection} }`;
}

interface IssueNode {
  id: string;
  identifier: string;
  title: string;
  url: string;
  description: string | null;
  priority: number;
  updatedAt: string;
}

interface Connection<N> {
  nodes?: N[];
  pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
}

interface GraphQLData {
  viewer?: { assignedIssues?: Connection<unknown> };
  issues?: Connection<unknown>;
  users?: Connection<{ id: string; name?: string; displayName?: string }>;
  teams?: Connection<{ id: string; name?: string }>;
  projects?: Connection<{ id: string; name?: string }>;
}

/**
 * POST a GraphQL operation with the raw-key auth header and shared error handling. Throws the
 * RateLimited sentinel on a RATELIMITED response so the poll loop can back off, and a plain Error on
 * any other failure. The API key is passed raw in Authorization (assumption A4 — no scheme prefix)
 * and never logged; the filter always arrives as a typed `$filter` variable, never interpolated
 * (tampering and info-disclosure guards).
 */
async function postGraphQL(
  apiKey: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<GraphQLData> {
  const res = await fetch(LINEAR_GRAPHQL_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: apiKey },
    body: JSON.stringify({ query, variables }),
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
    data?: GraphQLData;
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

  if (!body.data) {
    throw new Error(`Linear response missing data (HTTP ${res.status})`);
  }
  return body.data;
}

/**
 * Select the issue connection from a response by query shape: `viewer.assignedIssues` for the
 * viewer-scope default, root `issues` otherwise. Keeping the accessor swap in one place lets both
 * `fetch` paging and `countMatches` read the same connection through the same builder decision.
 */
function issueConnection(
  data: GraphQLData,
  useViewerScope: boolean,
): Connection<unknown> | undefined {
  return useViewerScope ? data.viewer?.assignedIssues : data.issues;
}

/**
 * Fetch one page of issues for the active shape. Throws on a missing connection (a contract
 * violation), otherwise returns the page nodes and cursor state for `fetchAllIssues` to walk.
 */
async function fetchPage(
  apiKey: string,
  query: string,
  useViewerScope: boolean,
  filter: LinearIssueFilter,
  after: string | null,
): Promise<{
  nodes: IssueNode[];
  hasNextPage: boolean;
  endCursor: string | null;
}> {
  const data = await postGraphQL(apiKey, query, { after, filter });
  const conn = issueConnection(data, useViewerScope);
  if (!conn || !Array.isArray(conn.nodes)) {
    throw new Error("Linear response missing issues connection");
  }
  return {
    nodes: conn.nodes as IssueNode[],
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
  useViewerScope: boolean,
  filter: LinearIssueFilter,
): Promise<{ issues: SourceIssue[]; truncated: boolean }> {
  const query = boardQuery(useViewerScope);
  const nodes: IssueNode[] = [];
  let after: string | null = null;
  let lastHasNextPage = false;
  for (let page = 0; page < MAX_PAGES; page++) {
    const {
      nodes: pageNodes,
      hasNextPage,
      endCursor,
    } = await fetchPage(apiKey, query, useViewerScope, filter, after);
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

const USERS_QUERY = `query Users($onlyActive: UserFilter) { users(filter: $onlyActive, first: ${PAGE_SIZE}) { nodes { id name displayName } } }`;
const ACTIVE_USERS: Record<string, unknown> = { active: { eq: true } };
const TEAMS_QUERY = `query Teams { teams(first: ${PAGE_SIZE}) { nodes { id name } } }`;
const PROJECTS_QUERY = `query Projects { projects(first: ${PAGE_SIZE}) { nodes { id name } } }`;

/**
 * The Linear TicketSource: owns the GraphQL query, cursor paging, prefix-less auth, and RATELIMITED
 * detection. Constructed at boot with the resolved API key plus a live-filters accessor — `fetch()`
 * re-reads the current filters every cycle through the shared builder, so a settings save takes
 * effect on the next poll with no restart and no boot closure. `listOptions`/`countMatches` back the
 * settings dropdowns and the match-count preview, and `capabilities` declares the four dimensions
 * the settings UI may render (SRC-06).
 */
export class LinearSource implements TicketSource {
  readonly id = "linear";

  static capabilities: FilterCapabilities = {
    dimensions: ["assignees", "projects", "teams", "cycle"],
  };

  readonly capabilities: FilterCapabilities = LinearSource.capabilities;

  constructor(
    private apiKey: string,
    private getFilters: () => SourceFilters,
  ) {}

  fetch(): Promise<{ issues: SourceIssue[]; truncated: boolean }> {
    const { useViewerScope, filter } = buildLinearQuery(this.getFilters());
    return fetchAllIssues(this.apiKey, useViewerScope, filter);
  }

  async listOptions(
    dimension: "assignees" | "projects" | "teams",
  ): Promise<FilterOption[]> {
    if (dimension === "assignees") {
      const data = await postGraphQL(this.apiKey, USERS_QUERY, {
        onlyActive: ACTIVE_USERS,
      });
      return (data.users?.nodes ?? []).map((n) => ({
        id: n.id,
        label: n.displayName ?? n.name ?? n.id,
      }));
    }
    if (dimension === "teams") {
      const data = await postGraphQL(this.apiKey, TEAMS_QUERY, {});
      return (data.teams?.nodes ?? []).map((n) => ({
        id: n.id,
        label: n.name ?? n.id,
      }));
    }
    const data = await postGraphQL(this.apiKey, PROJECTS_QUERY, {});
    return (data.projects?.nodes ?? []).map((n) => ({
      id: n.id,
      label: n.name ?? n.id,
    }));
  }

  async countMatches(
    filters: SourceFilters,
  ): Promise<{ count: number; more: boolean }> {
    const { useViewerScope, filter } = buildLinearQuery(filters);
    const data = await postGraphQL(this.apiKey, countQuery(useViewerScope), {
      filter,
    });
    const conn = issueConnection(data, useViewerScope);
    const count = Array.isArray(conn?.nodes) ? conn.nodes.length : 0;
    return { count, more: conn?.pageInfo?.hasNextPage ?? false };
  }
}
