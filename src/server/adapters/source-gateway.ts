import {
  buildRegistry,
  getLinearSource,
  getSource,
  isSourceEnabled,
  listSources,
} from "../sources/registry.js";
import {
  fetchLinearAccount,
  testLinearConnection as testImpl,
} from "../sources/linear/linear.source.js";
import { fetchGithubLogin } from "../sources/github/github.source.js";
import { fetchSentryAccount } from "../sources/sentry/sentry.source.js";
import {
  fetchSentryIssue as fetchIssueImpl,
  resolveSentryIssue as resolveIssueImpl,
} from "../sources/sentry/sentry-issue.js";
import {
  fetchPrDetail,
  postPrReview,
  squashMergePr,
} from "../sources/github/github-pr.js";

export {
  GitHubAuthError,
  GitHubRequestError,
  GitHubSsoError,
} from "../sources/github/github.source.js";
export {
  SentryAuthError,
  SentryRequestError,
} from "../sources/sentry/sentry.source.js";
export { RateLimited as SourceRateLimited } from "../sources/ticket.source.js";
import type {
  FilterCapabilities,
  FilterDimension,
  FilterOption,
  TicketSource,
} from "../sources/ticket.source.js";
import type {
  Config,
  PrDetail,
  PrReviewEvent,
  SentryIssueDetail,
  SourceFilters,
} from "../../shared/types.js";

export { LINEAR_GRAPHQL_URL } from "../sources/linear/linear.source.js";
export type { TicketSource };

/**
 * Thrown when a route asks for a source id the registry does not serve. It lives in the adapters
 * layer so routes can map it to a 404 without importing `sources` directly — the eslint boundary
 * forbids routes from reaching into `sources`, so this gateway is the only seam between them.
 */
export class SourceNotFound extends Error {
  constructor(sourceId: string) {
    super(`unknown source: ${sourceId}`);
    this.name = "SourceNotFound";
  }
}

/**
 * Resolve a source id to its TicketSource. Only `linear` exists today; anything else is a
 * SourceNotFound the route turns into a 404, keeping the not-found decision out of the routes layer.
 */
function resolveSource(sourceId: string): TicketSource {
  if (sourceId !== "linear") {
    throw new SourceNotFound(sourceId);
  }
  return getLinearSource();
}

/** The source's static filter surface — the dimensions the settings UI is allowed to render. */
export function getSourceCapabilities(sourceId: string): FilterCapabilities {
  return resolveSource(sourceId).capabilities;
}

/** Live workspace options for a multi-select dimension (users/teams/projects), fetched on demand. */
export function listSourceOptions(
  sourceId: string,
  dimension: Exclude<FilterDimension, "cycle">,
): Promise<{ options: FilterOption[]; truncated: boolean }> {
  return resolveSource(sourceId).listOptions(dimension);
}

/** Match count for a candidate filter set, routed through the poll's own builder (preview == reality). */
export function countSourceMatches(
  sourceId: string,
  filters: SourceFilters,
): Promise<{ count: number; more: boolean }> {
  return resolveSource(sourceId).countMatches(filters);
}

/**
 * Rebuild the source registry from a (now key-carrying) config — the seam the first-run setup route
 * uses to swap the keyless registry for one that can poll, without importing `sources` directly.
 */
export function rebuildSources(config: Config): void {
  buildRegistry(config);
}

/** Live Linear key check for the setup route (viewer query); the only seam routes may reach it through. */
export function testLinearConnection(apiKey: string): Promise<boolean> {
  return testImpl(apiKey);
}

/**
 * Check a key live and return its account, or null when the source rejects it.
 *
 * @remarks Re-throws every failure that is not a credential rejection so the route can answer
 * unreachable.
 */
export function checkSourceKey(
  sourceId: string,
  apiKey: string,
): Promise<{ account?: string } | null> {
  resolveSource(sourceId);
  return fetchLinearAccount(apiKey);
}

/**
 * Check a GitHub token live and return its login, or null when GitHub rejects it.
 *
 * @remarks Re-throws every other failure, including the SSO error, so callers can tell them apart.
 */
export function checkGithubToken(
  token: string,
): Promise<{ account?: string } | null> {
  return fetchGithubLogin(token);
}

/** Check a Sentry token live and return its organizations label, or null when Sentry rejects it. */
export function checkSentryToken(
  token: string,
): Promise<{ account?: string } | null> {
  return fetchSentryAccount(token);
}

/** Read one Sentry issue with its latest event, on the organization's allowed region. */
export function fetchSentryIssue(
  token: string,
  org: string,
  regionUrl: string | undefined,
  issueId: string,
): Promise<SentryIssueDetail> {
  return fetchIssueImpl(token, org, regionUrl, issueId);
}

/** Resolve one Sentry issue, on the organization's allowed region. */
export function resolveSentryIssue(
  token: string,
  org: string,
  regionUrl: string | undefined,
  issueId: string,
): Promise<void> {
  return resolveIssueImpl(token, org, regionUrl, issueId);
}

/** Read one pull request's detail with a GitHub token. */
export function fetchGithubPr(
  token: string,
  owner: string,
  repo: string,
  number: number,
): Promise<PrDetail> {
  return fetchPrDetail(token, owner, repo, number);
}

/** Post a review on one pull request with a GitHub token. */
export function reviewGithubPr(
  token: string,
  owner: string,
  repo: string,
  number: number,
  review: { event: PrReviewEvent; body?: string },
): Promise<void> {
  return postPrReview(token, owner, repo, number, review);
}

/** Squash merge one pull request at a given head commit with a GitHub token. */
export function mergeGithubPr(
  token: string,
  owner: string,
  repo: string,
  number: number,
  sha: string,
): Promise<void> {
  return squashMergePr(token, owner, repo, number, sha);
}

/** The source when it is registered and enabled, for services that write to it. */
export function enabledSource(sourceId: string): TicketSource | undefined {
  return isSourceEnabled(sourceId) ? getSource(sourceId) : undefined;
}

/** Whether a source id is registered and enabled, for routes that must answer 404 or 409. */
export function sourceState(
  sourceId: string,
): "enabled" | "disabled" | "unknown" {
  if (!getSource(sourceId)) return "unknown";
  return isSourceEnabled(sourceId) ? "enabled" : "disabled";
}

/** Ids of the sources that declare a vault key name, for the Vault page's "Used by" line. */
export function vaultKeyUsers(
  name: string,
  sources: readonly TicketSource[] = listSources(),
): string[] {
  return sources.filter((s) => s.vaultKeys.includes(name)).map((s) => s.id);
}
