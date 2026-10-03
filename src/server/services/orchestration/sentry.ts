import type { SentryIssueDetail } from "../../../shared/types.js";
import {
  fetchSentryIssue,
  resolveSentryIssue,
} from "../../adapters/source-gateway.js";
import { boardRepository as store } from "../../store/board-repository.js";
import { getOrchestrationConfig } from "../infra/config-holder.js";
import { resolveSentryToken } from "../infra/sentry-token.js";

export class SentryNotConnected extends Error {
  constructor() {
    super("no Sentry credential is available");
    this.name = "SentryNotConnected";
  }
}

export class SentryItemUnknown extends Error {
  constructor() {
    super("no Sentry item has this issue id");
    this.name = "SentryItemUnknown";
  }
}

/**
 * The stored item for an issue, whose meta names the organization and region to ask.
 *
 * @remarks Checked before the token so an unknown id never reaches Sentry.
 */
function issueItem(issueId: string): {
  id: string;
  org: string;
  regionUrl: string | undefined;
} {
  const item = store.getItem(`sentry:${issueId}`);
  const org = item?.meta.org;
  if (!item || !org) throw new SentryItemUnknown();
  return { id: item.id, org, regionUrl: item.meta.regionUrl };
}

/** Resolve the token for an issue call, refusing while the Sentry source is disconnected. */
async function token(): Promise<string> {
  if (getOrchestrationConfig()?.sources?.sentry?.enabled !== true) {
    throw new SentryNotConnected();
  }
  const credential = await resolveSentryToken();
  if (!credential) throw new SentryNotConnected();
  return credential.token;
}

/** Read one issue's detail with its latest event. */
export async function getSentryIssue(
  issueId: string,
): Promise<SentryIssueDetail> {
  const { org, regionUrl } = issueItem(issueId);
  return fetchSentryIssue(await token(), org, regionUrl, issueId);
}

/** Resolve an issue in Sentry and answer the id of its item. */
export async function resolveSentryIssueItem(issueId: string): Promise<string> {
  const { id, org, regionUrl } = issueItem(issueId);
  await resolveSentryIssue(await token(), org, regionUrl, issueId);
  return id;
}
