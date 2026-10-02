import type {
  ClaudeAccountSummary,
  ClaudeLoginView,
  ClaudeUsageSnapshot,
} from "../../../../shared/types.js";
import { http, httpError } from "@/lib/http";

/**
 * Fetch every Claude account with its usage snapshot plus the active pointer: GET /api/accounts.
 *
 * @remarks
 * Throws on any non-2xx.
 */
export async function getAccounts(): Promise<{
  activeId: string;
  accounts: ClaudeAccountSummary[];
}> {
  const result = await http<{
    activeId: string;
    accounts: ClaudeAccountSummary[];
  }>("/api/accounts");
  if (!result.ok) {
    throw httpError("getAccounts", result);
  }
  return result.data;
}

/**
 * Make an account the one new sessions launch on: PUT /api/accounts/active.
 */
export async function setActiveAccount(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await http("/api/accounts/active", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
  if (result.ok) return { ok: true };
  if (result.status === 404) {
    return { ok: false, error: "That account is no longer registered." };
  }
  return { ok: false, error: "Couldn't switch the Claude account." };
}

/**
 * Fetch an account's usage now: POST /api/accounts/:id/usage/refresh.
 *
 * @remarks
 * A 429 means the 30 second limiter refused, which the caller shows as a wait notice rather than
 * an error.
 */
export async function refreshAccountUsage(
  id: string,
): Promise<
  { ok: true; usage: ClaudeUsageSnapshot } | { ok: false; error: string }
> {
  const result = await http<{ usage: ClaudeUsageSnapshot }>(
    `/api/accounts/${encodeURIComponent(id)}/usage/refresh`,
    {
      method: "POST",
    },
  );
  if (result.ok) {
    return { ok: true, usage: result.data.usage };
  }
  if (result.status === 429) {
    return { ok: false, error: "Wait 30 seconds between refreshes." };
  }
  return { ok: false, error: "Couldn't refresh usage." };
}

/**
 * Start a Claude login for a new account, or for `accountId` to repair its token: POST /api/accounts/login.
 *
 * @remarks
 * A 409 means one is already running.
 */
export async function startLogin(
  accountId?: string,
): Promise<
  | { ok: true; accountId: string | null }
  | { ok: false; error: string; inFlight?: boolean }
> {
  const result = await http<ClaudeLoginView | null>("/api/accounts/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(accountId ? { accountId } : {}),
  });
  if (result.ok) {
    const view = result.data;
    return {
      ok: true,
      accountId:
        view && "accountId" in view ? view.accountId : (accountId ?? null),
    };
  }
  if (result.status === 409) {
    return {
      ok: false,
      error: "A Claude login is already in progress.",
      inFlight: true,
    };
  }
  if (result.status === 404) {
    return { ok: false, error: "That account is no longer registered." };
  }
  return { ok: false, error: "Couldn't start the Claude login." };
}

/**
 * Fetch the login state machine's current view: GET /api/accounts/login.
 */
export async function getLoginState(): Promise<ClaudeLoginView> {
  const result = await http<ClaudeLoginView>("/api/accounts/login");
  if (!result.ok) {
    throw httpError("getLoginState", result);
  }
  return result.data;
}

/**
 * Hand the pasted sign-in code to the waiting CLI: POST /api/accounts/login/code.
 */
export async function submitLoginCode(
  code: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await http("/api/accounts/login/code", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  if (result.ok) return { ok: true };
  if (result.status === 409) {
    return { ok: false, error: "No login is waiting for a code." };
  }
  if (result.status === 400) {
    return { ok: false, error: "Paste the whole code on one line." };
  }
  return { ok: false, error: "Couldn't submit the code." };
}

/**
 * Abort an in-flight login or clear a finished one: DELETE /api/accounts/login.
 */
export async function cancelLogin(): Promise<void> {
  await http("/api/accounts/login", { method: "DELETE" }).catch(
    () => undefined,
  );
}

/**
 * Remove an added account: DELETE /api/accounts/:id.
 *
 * @remarks
 * The default account cannot be removed.
 */
export async function removeAccount(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await http(`/api/accounts/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (result.ok) return { ok: true };
  if (result.status === 404) {
    return { ok: false, error: "That account is no longer registered." };
  }
  if (result.status === 400) {
    return { ok: false, error: "The Default account cannot be removed." };
  }
  return { ok: false, error: "Couldn't remove the account." };
}
