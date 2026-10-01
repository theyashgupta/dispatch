export type ApiResult<T> =
  | { ok: true; status: number; data: T }
  | {
      ok: false;
      status: number;
      statusText: string;
      error: string | null;
      body: unknown;
    };

export type ApiFailure = Extract<ApiResult<unknown>, { ok: false }>;

const UNREADABLE = Symbol("unreadable");

function parseJson(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return UNREADABLE;
  }
}

/** Builds the Error that an api function throws for a failure result. */
export function httpError(name: string, failure: ApiFailure): Error {
  return new Error(`${name} failed: ${failure.status} ${failure.statusText}`);
}

/** Returns the data of a success result, or the raw body of a failure result. */
export function payload(result: ApiResult<unknown>): unknown {
  return result.ok ? result.data : result.body;
}

/**
 * Fetches a URL and returns the status and parsed JSON body as a typed result.
 *
 * @remarks
 * Network failures and aborts reject as fetch does. 4xx and 5xx responses become data, not throws, and so does a 2xx whose non-empty body is not JSON. A body that fails to stream after the headers reads as empty unless the request was aborted.
 */
export async function http<T>(
  url: string,
  init?: RequestInit,
): Promise<ApiResult<T>> {
  const res = await fetch(url, init);
  const text = await res.text().catch((err: unknown) => {
    if (init?.signal?.aborted) throw err;
    return "";
  });
  const parsed = parseJson(text);
  const value = parsed === UNREADABLE ? null : parsed;
  if (res.ok && parsed !== UNREADABLE) {
    return { ok: true, status: res.status, data: value as T };
  }
  const code = (value as { error?: unknown } | null)?.error;
  return {
    ok: false,
    status: res.status,
    statusText: res.statusText,
    error: typeof code === "string" ? code : null,
    body: value,
  };
}
