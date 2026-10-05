import { http, type ApiResult } from "@/lib/http";

export type ProviderResult<T> =
  | ({ ok: true } & T)
  | { ok: false; error: string; message?: string; ssoUrl?: string };

type ProviderResponse<T> = ApiResult<T> | null;

/** Request a provider route, turning a network failure into a null result. */
export async function providerFetch<T>(
  url: string,
  init?: RequestInit,
): Promise<ProviderResponse<T>> {
  try {
    return await http<T>(url, init);
  } catch {
    return null;
  }
}

/** Turn a failed or missing provider response into the typed failure result. */
export function providerFailure(result: ProviderResponse<unknown>): {
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
