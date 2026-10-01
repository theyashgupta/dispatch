import type {
  FilterCapabilities,
  FilterOption,
  LinearWorkflow,
  SlackChannel,
  SlackChannelOption,
  SourceConnection,
  SourceFilters,
  SourceKeyError,
} from "../../../../shared/types.js";
import { isProviderCode } from "../../../../shared/credential.js";
import { http, type ApiResult, httpError, payload } from "@/lib/http";

export type LinearOptionDimension = "assignees" | "projects" | "teams";

/**
 * Ask the server to poll one source now: POST /api/sources/:id/poll.
 *
 * @remarks
 * Throws on any non-2xx so Sync now can report a refused source; the poll result arrives
 * over SSE like any scheduled poll. The error message is the server's own reason (source disabled,
 * unknown source) or "server unreachable", so the Flow page can show it as is.
 */
export async function pollSource(id: string): Promise<void> {
  let result: ApiResult<unknown>;
  try {
    result = await http(`/api/sources/${encodeURIComponent(id)}/poll`, {
      method: "POST",
    });
  } catch {
    throw new Error("server unreachable");
  }
  if (!result.ok) {
    throw new Error(result.error ?? `poll failed (${result.status})`);
  }
}

/**
 * Read the Linear source's persisted filters plus its capability descriptor: GET /api/sources/linear/filters.
 *
 * @remarks
 * The apiKey never crosses this boundary, so the route returns only `{ filters, capabilities }`.
 * Throws on any non-2xx so the modal can surface a load failure.
 */
export async function getLinearFilters(): Promise<{
  filters: SourceFilters;
  capabilities: FilterCapabilities;
}> {
  const result = await http<{
    filters: SourceFilters;
    capabilities: FilterCapabilities;
  }>("/api/sources/linear/filters");
  if (!result.ok) {
    throw httpError("getLinearFilters", result);
  }
  return result.data;
}

/**
 * List the live workspace options for one multi-select dimension: GET /api/sources/linear/options?dimension=.
 *
 * @remarks
 * Resolves the `options` array plus a `truncated` flag, true when the source capped the list at
 * its first page. Throws on any non-2xx, including the 502 upstream failure, so the modal shows
 * its per-dimension load-failure line.
 */
export async function getLinearOptions(
  dimension: LinearOptionDimension,
): Promise<{ options: FilterOption[]; truncated: boolean }> {
  const result = await http<{
    options: FilterOption[];
    truncated?: boolean;
  }>(`/api/sources/linear/options?dimension=${encodeURIComponent(dimension)}`);
  if (!result.ok) {
    throw httpError("getLinearOptions", result);
  }
  return {
    options: result.data.options,
    truncated: result.data.truncated === true,
  };
}

/**
 * Count the tickets a draft filter would match: POST /api/sources/linear/preview.
 *
 * @remarks
 * Advisory only and must never block Save, so any failure resolves to `null`, the preview-
 * unavailable sentinel, instead of rejecting. A 2xx resolves `{ count, more }`.
 */
export async function previewLinearFilters(
  filters: SourceFilters,
): Promise<{ count: number; more: boolean } | null> {
  try {
    const result = await http<{ count: number; more: boolean }>(
      "/api/sources/linear/preview",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filters }),
      },
    );
    if (!result.ok) {
      return null;
    }
    return result.data;
  } catch {
    return null;
  }
}

/**
 * Persist the Linear source's filter draft: PUT /api/sources/linear/filters.
 *
 * @remarks
 * A 200 resolves `{ ok: true }`, a 400 resolves `{ ok: false, error }` from the parsed body for
 * the modal to show verbatim, and any other status throws.
 */
export async function saveLinearFilters(
  filters: SourceFilters,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await http("/api/sources/linear/filters", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filters }),
  });
  if (result.ok) {
    return { ok: true };
  }
  if (result.status === 400) {
    return { ok: false, error: result.error ?? "Couldn't save filters." };
  }
  throw httpError("saveLinearFilters", result);
}

/** The viewer and the Linear teams with their states: GET /api/sources/linear/workflow. */
export async function getLinearWorkflow(): Promise<
  { ok: true; workflow: LinearWorkflow } | { ok: false; error: string }
> {
  try {
    const result = await http<LinearWorkflow>("/api/sources/linear/workflow");
    if (result.ok) {
      return { ok: true, workflow: result.data };
    }
    return { ok: false, error: result.error ?? "Could not load Linear teams." };
  } catch {
    return { ok: false, error: "Could not reach Dispatch. Try again." };
  }
}

/**
 * Read a source's connection status: GET /api/sources/:source/connection.
 *
 * @remarks
 * Throws on any non-2xx.
 */
export async function getSourceConnection(
  source: string,
): Promise<SourceConnection> {
  const result = await http<SourceConnection>(
    `/api/sources/${encodeURIComponent(source)}/connection`,
  );
  if (!result.ok) {
    throw new Error(`getSourceConnection failed: ${result.status}`);
  }
  return result.data;
}

const SOURCE_KEY_ERRORS = new Set<string>([
  "rejected",
  "unreachable",
  "sso-required",
  "superseded",
  "no-credential",
]);

/**
 * Read the error kind a failed key save or connect answered, plus the provider's own error code.
 *
 * @remarks
 * The server names the kind in the body; the status fallback covers a body that is not
 * JSON, such as a proxy error page. Only a plain lowercase provider code is kept.
 */
function sourceKeyFailure(result: Extract<ApiResult<unknown>, { ok: false }>): {
  ok: false;
  reason: SourceKeyError;
  providerError?: string;
} {
  const body = (result.body ?? {}) as {
    error?: unknown;
    providerError?: unknown;
  };
  const reason: SourceKeyError =
    typeof body.error === "string" && SOURCE_KEY_ERRORS.has(body.error)
      ? (body.error as SourceKeyError)
      : result.status === 400
        ? "rejected"
        : result.status === 502
          ? "unreachable"
          : result.status === 409
            ? "superseded"
            : "failed";
  return isProviderCode(body.providerError)
    ? { ok: false, reason, providerError: body.providerError }
    : { ok: false, reason };
}

/**
 * Store a new key for a source: PUT /api/sources/:source/key.
 *
 * @remarks
 * The server checks the key with the provider before saving it, so a 400 (rejected) and a
 * 502 (unreachable) both mean nothing was written; a 409 means a disconnect won the race. The key
 * is sent once and never echoed back.
 */
export async function saveSourceKey(
  source: string,
  apiKey: string,
): Promise<
  | { ok: true; account?: string }
  | { ok: false; reason: SourceKeyError; providerError?: string }
> {
  const result = await http<{ account?: string }>(
    `/api/sources/${encodeURIComponent(source)}/key`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey }),
    },
  );
  if (result.ok) {
    return { ok: true, ...result.data };
  }
  return sourceKeyFailure(result);
}

/**
 * Turn a token source on with the credential it already has: POST /api/sources/:source/connect.
 *
 * @remarks
 * Used when the Vault already holds the token or the gh CLI is logged in, so nothing is
 * pasted and no secret crosses the wire.
 */
export async function connectSource(
  source: string,
): Promise<
  | { ok: true; account?: string }
  | { ok: false; reason: SourceKeyError; providerError?: string }
> {
  const result = await http<{ account?: string }>(
    `/api/sources/${encodeURIComponent(source)}/connect`,
    { method: "POST" },
  );
  if (result.ok) {
    return { ok: true, ...result.data };
  }
  return sourceKeyFailure(result);
}

/**
 * Pause a token source and keep its token: POST /api/sources/:source/disable.
 *
 * @remarks
 * Throws on any non-2xx.
 */
export async function disableSource(source: string): Promise<void> {
  const result = await http(
    `/api/sources/${encodeURIComponent(source)}/disable`,
    { method: "POST" },
  );
  if (!result.ok) {
    throw new Error(`disableSource failed: ${result.status}`);
  }
}

/**
 * Read the saved Slack channels: GET /api/sources/slack/channels.
 *
 * @remarks
 * Throws on any non-2xx.
 */
export async function getSavedSlackChannels(): Promise<SlackChannel[]> {
  const result = await http<{ channels: SlackChannel[] }>(
    "/api/sources/slack/channels",
  );
  if (!result.ok) {
    throw new Error(`getSavedSlackChannels failed: ${result.status}`);
  }
  return result.data.channels;
}

export type SlackSetupFailure =
  "not-a-channel" | "disabled" | "rejected" | "restricted" | "unreachable";

/**
 * Map a Slack setup route's error kind to the line the picker shows.
 *
 * @remarks
 * A missing token reads as rejected and any unknown or unreadable answer as unreachable, so
 * the picker always has a line to show.
 */
function slackSetupFailure(error: unknown): SlackSetupFailure {
  if (
    error === "not-a-channel" ||
    error === "disabled" ||
    error === "rejected"
  ) {
    return error;
  }
  if (error === "no-credential") return "rejected";
  if (error === "missing-scope") return "restricted";
  return "unreachable";
}

/** List the Slack channels to pick: GET /api/slack/channels; any refusal answers its reason. */
export async function listSlackChannels(): Promise<
  | { ok: true; channels: SlackChannelOption[]; truncated: boolean }
  | { ok: false; reason: SlackSetupFailure }
> {
  try {
    const result = await http<unknown>("/api/slack/channels");
    const body = (payload(result) ?? {}) as {
      channels?: SlackChannelOption[];
      truncated?: boolean;
      error?: unknown;
    };
    if (!result.ok || !body.channels) {
      return { ok: false, reason: slackSetupFailure(body.error) };
    }
    return {
      ok: true,
      channels: body.channels,
      truncated: body.truncated === true,
    };
  } catch {
    return { ok: false, reason: "unreachable" };
  }
}

/** Resolve a pasted channel link or id: POST /api/slack/channels/resolve; any refusal answers its reason. */
export async function resolveSlackChannel(
  input: string,
): Promise<
  | { ok: true; id: string; name: string }
  | { ok: false; reason: SlackSetupFailure }
> {
  try {
    const result = await http<unknown>("/api/slack/channels/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input }),
    });
    const body = (payload(result) ?? {}) as {
      id?: string;
      name?: string;
      error?: unknown;
    };
    if (result.ok && body.id && body.name) {
      return { ok: true, id: body.id, name: body.name };
    }
    return { ok: false, reason: slackSetupFailure(body.error) };
  } catch {
    return { ok: false, reason: "unreachable" };
  }
}

/** Save the picked Slack channels: PUT /api/sources/slack/channels; null when the save failed. */
export async function saveSlackChannels(
  channels: SlackChannel[],
): Promise<SlackChannel[] | null> {
  try {
    const result = await http<{ channels: SlackChannel[] }>(
      "/api/sources/slack/channels",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channels }),
      },
    );
    if (!result.ok) return null;
    return result.data.channels;
  } catch {
    return null;
  }
}

/**
 * Remove a source's stored key: DELETE /api/sources/:source/key.
 *
 * @remarks
 * Throws on any non-2xx.
 */
export async function deleteSourceKey(source: string): Promise<void> {
  const result = await http(`/api/sources/${encodeURIComponent(source)}/key`, {
    method: "DELETE",
  });
  if (!result.ok) {
    throw new Error(`deleteSourceKey failed: ${result.status}`);
  }
}
