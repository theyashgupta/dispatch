import { prKey } from "../../../shared/pr-rows.js";
import type { Item } from "../../../shared/types.js";

export const OPEN_PRS_PAGE = 100;

const SNIPPET_MAX = 280;

/** Build the unread GitHub item that both the `@me` search and the open pull request search return. */
export function githubItem(input: {
  repo: string;
  number: number;
  type: Item["type"];
  title: string;
  body: string | null | undefined;
  url: string | undefined;
  updatedAt: string;
  priority: number;
  meta: Record<string, string>;
}): Item {
  const [owner = "", name = ""] = input.repo.split("/");
  return {
    id: prKey(owner, name, input.number),
    source: "github",
    type: input.type,
    title: input.title,
    snippet: (input.body ?? "").trim().slice(0, SNIPPET_MAX),
    url: input.url,
    createdAt: input.updatedAt,
    priority: input.priority,
    state: "unread",
    meta: { repo: input.repo, number: String(input.number), ...input.meta },
  };
}

const OPEN_PRS_QUERY = `query($q: String!, $first: Int!) {
  search(query: $q, type: ISSUE, first: $first) {
    issueCount
    nodes {
      ... on PullRequest {
        number
        title
        body
        url
        createdAt
        updatedAt
        isDraft
        reviewDecision
        headRefName
        baseRefName
        changedFiles
        author { login }
        repository { nameWithOwner }
        reviewRequests(first: 30) {
          nodes { requestedReviewer { ... on User { login } } }
        }
        commits(last: 1) {
          nodes { commit { statusCheckRollup { state } } }
        }
      }
    }
  }
}`;

export interface OpenPrsRequest {
  query: string;
  variables: { q: string; first: number };
}

interface PrNode {
  number?: number;
  title?: string;
  body?: string | null;
  url?: string;
  createdAt?: string;
  updatedAt?: string;
  isDraft?: boolean;
  reviewDecision?: string | null;
  headRefName?: string;
  baseRefName?: string;
  changedFiles?: number;
  author?: { login?: string } | null;
  repository?: { nameWithOwner?: string };
  reviewRequests?: {
    nodes?: ({ requestedReviewer?: { login?: string } | null } | null)[];
  };
  commits?: {
    nodes?: ({
      commit?: { statusCheckRollup?: { state?: string } | null };
    } | null)[];
  };
}

export interface OpenPrsAnswer {
  errors?: unknown[];
  data?: { search?: { issueCount?: number; nodes?: (PrNode | null)[] } };
}

export function openPrsRequest(repos: readonly string[]): OpenPrsRequest {
  return {
    query: OPEN_PRS_QUERY,
    variables: {
      q: `is:open is:pr ${repos.map((r) => `repo:${r}`).join(" ")} sort:updated-desc`,
      first: OPEN_PRS_PAGE,
    },
  };
}

function checksOf(state: string | undefined): string {
  switch (state) {
    case "SUCCESS":
      return "pass";
    case "FAILURE":
    case "ERROR":
      return "fail";
    case "PENDING":
    case "EXPECTED":
      return "pending";
    default:
      return "";
  }
}

/**
 * Map a GraphQL search answer to `pr_open` items and say whether the list is incomplete.
 *
 * @remarks An `errors` array or more than one page of results sets truncated, so a partial answer
 * never resolves items it did not see. With `errors`, the nodes GitHub still returned are mapped
 * and the error messages (never the token or the body) are logged, because one repository the
 * token cannot search must not blank the others silently.
 */
export function mapOpenPrs(
  answer: OpenPrsAnswer,
  login: string,
): { items: Item[]; truncated: boolean } {
  const errors = answer.errors ?? [];
  if (errors.length > 0) {
    const messages = errors.map((e) => {
      const message = (e as { message?: unknown } | null)?.message;
      return typeof message === "string" ? message.slice(0, 200) : "unknown";
    });
    console.warn(
      `[github] open pull request search errors: ${messages.join("; ")}`,
    );
  }
  const search = answer.data?.search;
  const items: Item[] = [];
  for (const node of search?.nodes ?? []) {
    if (!node || node.number === undefined || !node.repository?.nameWithOwner) {
      continue;
    }
    const repo = node.repository.nameWithOwner;
    const requested = (node.reviewRequests?.nodes ?? []).some(
      (n) => login !== "" && n?.requestedReviewer?.login === login,
    );
    items.push(
      githubItem({
        repo,
        number: node.number,
        type: "pr_open",
        title: node.title ?? "",
        body: node.body,
        url: node.url,
        updatedAt: node.updatedAt ?? "",
        priority: 25,
        meta: {
          author: node.author?.login ?? "",
          draft: node.isDraft === true ? "true" : "false",
          reviewDecision: node.reviewDecision ?? "",
          reviewRequestedFromMe: requested ? "true" : "false",
          checks: checksOf(
            node.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state,
          ),
          createdAt: node.createdAt ?? "",
          headRef: node.headRefName ?? "",
          baseRef: node.baseRefName ?? "",
          changedFiles: String(node.changedFiles ?? 0),
          category: "open",
        },
      }),
    );
  }
  return {
    items,
    truncated: errors.length > 0 || (search?.issueCount ?? 0) > OPEN_PRS_PAGE,
  };
}
