import type { SentryIssueDetail } from "../../../../shared/types.js";
import {
  providerFailure,
  providerFetch,
  type ProviderResult,
} from "@/queries/provider-api";

/** Read one Sentry issue with its latest event: GET /api/sentry/issue/:id. */
export async function getSentryIssue(
  issueId: string,
): Promise<ProviderResult<{ detail: SentryIssueDetail }>> {
  const result = await providerFetch<SentryIssueDetail>(
    `/api/sentry/issue/${encodeURIComponent(issueId)}`,
  );
  if (!result?.ok) return providerFailure(result);
  return { ok: true, detail: result.data };
}

/** Resolve one Sentry issue; the server marks its item done only after Sentry agrees. */
export async function resolveSentryIssue(
  issueId: string,
): Promise<ProviderResult<object>> {
  const result = await providerFetch(
    `/api/sentry/issue/${encodeURIComponent(issueId)}/resolve`,
    { method: "POST" },
  );
  return result?.ok ? { ok: true } : providerFailure(result);
}
