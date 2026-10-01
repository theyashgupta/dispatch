import type { SentryIssueDetail } from "../../../../shared/types.js";
import { http, type ApiResult } from "@/lib/http";

type SentryResult<T> =
  | ({ ok: true } & T)
  | { ok: false; error: string; message?: string; ssoUrl?: string };

type SentryResponse<T> = ApiResult<T> | null;

/** Request a Sentry route, turning a network failure into a null result. */
async function sentryFetch<T>(
  url: string,
  init?: RequestInit,
): Promise<SentryResponse<T>> {
  try {
    return await http<T>(url, init);
  } catch {
    return null;
  }
}

function sentryFailure(result: SentryResponse<unknown>): {
  ok: false;
  error: string;
  message?: string;
  ssoUrl?: string;
} {
  if (!result || result.ok) return { ok: false, error: "unreachable" };
  const body = (result.body ?? {}) as {
    message?: unknown;
    ssoUrl?: unknown;
  };
  return {
    ok: false,
    error: result.error ?? "unreachable",
    ...(typeof body.message === "string" ? { message: body.message } : {}),
    ...(typeof body.ssoUrl === "string" ? { ssoUrl: body.ssoUrl } : {}),
  };
}

/** Read one Sentry issue with its latest event: GET /api/sentry/issue/:id. */
export async function getSentryIssue(
  issueId: string,
): Promise<SentryResult<{ detail: SentryIssueDetail }>> {
  const result = await sentryFetch<SentryIssueDetail>(
    `/api/sentry/issue/${encodeURIComponent(issueId)}`,
  );
  if (!result?.ok) return sentryFailure(result);
  return { ok: true, detail: result.data };
}

/** Resolve one Sentry issue; the server marks its item done only after Sentry agrees. */
export async function resolveSentryIssue(
  issueId: string,
): Promise<SentryResult<object>> {
  const result = await sentryFetch(
    `/api/sentry/issue/${encodeURIComponent(issueId)}/resolve`,
    { method: "POST" },
  );
  return result?.ok ? { ok: true } : sentryFailure(result);
}
