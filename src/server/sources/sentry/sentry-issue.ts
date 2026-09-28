import type {
  SentryBreadcrumb,
  SentryFrame,
  SentryIssueDetail,
} from "../../../shared/types.js";
import {
  allowedRegion,
  SENTRY_API_URL,
  SentryAuthError,
  sentryRequest,
  type RawSentryIssue,
} from "./sentry.source.js";
import { RateLimited } from "../ticket.source.js";

const FRAMES_MAX = 25;

const BREADCRUMBS_MAX = 12;

export interface RawSentryIssueDetail extends RawSentryIssue {
  firstSeen?: string | null;
  status?: string | null;
}

interface RawFrame {
  function?: string | null;
  filename?: string | null;
  absPath?: string | null;
  lineNo?: number | null;
  colNo?: number | null;
  inApp?: boolean | null;
  module?: string | null;
  context?: [number, string][] | null;
}

interface RawException {
  type?: string | null;
  value?: string | null;
  stacktrace?: { frames?: RawFrame[] | null } | null;
}

interface RawBreadcrumb {
  timestamp?: string | null;
  type?: string | null;
  category?: string | null;
  level?: string | null;
  message?: string | null;
}

interface RawEntry {
  type?: string;
  data?: { values?: unknown[] | null } | null;
}

export interface RawSentryEvent {
  entries?: RawEntry[] | null;
  tags?: { key?: string; value?: string }[] | null;
  logger?: string | null;
  platform?: string | null;
}

const str = (v: unknown): string | null =>
  typeof v === "string" && v !== "" ? v : null;

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/** The values list of the first event entry of a type, or an empty list. */
function entryValues(event: RawSentryEvent | null, type: string): unknown[] {
  const entry = event?.entries?.find((e) => e.type === type);
  const values = entry?.data?.values;
  return Array.isArray(values) ? values : [];
}

/** Map one raw stack frame, keeping only numbered context lines. */
function mapFrame(raw: RawFrame): SentryFrame {
  return {
    function: str(raw.function),
    file: str(raw.filename) ?? str(raw.absPath),
    line: num(raw.lineNo),
    column: num(raw.colNo),
    inApp: raw.inApp === true,
    module: str(raw.module),
    context: (Array.isArray(raw.context) ? raw.context : [])
      .filter(
        (c): c is [number, string] =>
          Array.isArray(c) &&
          typeof c[0] === "number" &&
          typeof c[1] === "string",
      )
      .map(([line, code]) => ({ line, code })),
  };
}

/**
 * Shape an issue and its latest event into the detail the Errors page renders.
 *
 * @remarks Sentry sends frames oldest first and lists a chained exception's outermost value last,
 * so the detail reads that value and keeps its newest 25 frames newest first, plus the last 12
 * breadcrumbs in their original order. A missing part becomes null or an empty list.
 */
export function mapSentryDetail(
  issue: RawSentryIssueDetail,
  event: RawSentryEvent | null,
): SentryIssueDetail {
  const exceptions = entryValues(event, "exception") as RawException[];
  const top = exceptions.at(-1);
  const frames = top?.stacktrace?.frames ?? [];
  const crumbs = entryValues(event, "breadcrumbs") as RawBreadcrumb[];
  const count = Number(issue.count ?? 0);
  return {
    id: issue.id,
    shortId: issue.shortId ?? "",
    title: issue.title,
    culprit: issue.culprit ?? "",
    permalink: str(issue.permalink),
    level: issue.level ?? "",
    project: issue.project?.slug ?? "",
    status: issue.status ?? "unresolved",
    count: Number.isFinite(count) ? count : 0,
    userCount: num(issue.userCount) ?? 0,
    firstSeen: str(issue.firstSeen),
    lastSeen: str(issue.lastSeen),
    exception: top ? { type: str(top.type), value: str(top.value) } : null,
    frames: frames.slice(-FRAMES_MAX).reverse().map(mapFrame),
    breadcrumbs: crumbs.slice(-BREADCRUMBS_MAX).map((b): SentryBreadcrumb => ({
      timestamp: str(b.timestamp),
      type: str(b.type),
      category: str(b.category),
      level: str(b.level),
      message: str(b.message),
    })),
    tags: (event?.tags ?? [])
      .filter((t) => typeof t.key === "string" && typeof t.value === "string")
      .map((t) => ({ key: t.key as string, value: t.value as string })),
    logger: str(event?.logger),
    platform: str(event?.platform),
  };
}

/** The API path of one issue in an organization. */
const issuePath = (org: string, issueId: string) =>
  `/api/0/organizations/${encodeURIComponent(org)}/issues/${encodeURIComponent(issueId)}/`;

/**
 * Read one issue and its latest event on the organization's allowed region.
 *
 * @remarks The stored region URL is re-checked here, because an item keeps a region its last
 * poll no longer vouched for. A latest event that fails for any other reason than a rejected token
 * or a rate limit leaves the issue without one, so the actions stay usable.
 */
export async function fetchSentryIssue(
  token: string,
  org: string,
  regionUrl: unknown,
  issueId: string,
): Promise<SentryIssueDetail> {
  const base = allowedRegion(regionUrl) ?? SENTRY_API_URL;
  const path = issuePath(org, issueId);
  const issue = (await (
    await sentryRequest(token, base, path)
  ).json()) as RawSentryIssueDetail;
  const event = await sentryRequest(token, base, `${path}events/latest/`)
    .then((res) => res.json() as Promise<RawSentryEvent | null>)
    .catch((err: unknown) => {
      if (err instanceof SentryAuthError || err instanceof RateLimited) {
        throw err;
      }
      return null;
    });
  return mapSentryDetail(issue, event);
}

/** Set one issue's status to resolved in Sentry, on the organization's allowed region. */
export async function resolveSentryIssue(
  token: string,
  org: string,
  regionUrl: unknown,
  issueId: string,
): Promise<void> {
  await sentryRequest(
    token,
    allowedRegion(regionUrl) ?? SENTRY_API_URL,
    issuePath(org, issueId),
    { method: "PUT", body: { status: "resolved" } },
  );
}
