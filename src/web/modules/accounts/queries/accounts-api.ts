import type {
  AccountSwitchResponse,
  ApplyChoice,
  ClaudeAccountsSettings,
  ClaudeLoginView,
  ClaudeUsageSnapshot,
} from "../../../../shared/types.js";
import { http, httpError } from "@/lib/http";

/**
 * Make an account the one new sessions launch on: PUT /api/accounts/active.
 *
 * @remarks
 * `applyToRunning` picks which running sessions follow. A success reports how many moved now,
 * how many wait for the end of their turn and how many the server skipped.
 */
export async function setActiveAccount(
  id: string,
  applyToRunning: ApplyChoice,
): Promise<
  | { ok: true; moved: number; queued: number; skipped: number }
  | { ok: false; error: string }
> {
  const result = await http<AccountSwitchResponse>("/api/accounts/active", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, applyToRunning }),
  });
  if (result.ok) {
    return {
      ok: true,
      moved: result.data.moved.length,
      queued: result.data.queued.length,
      skipped: result.data.skipped.length,
    };
  }
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

/**
 * Save the full chain order: PUT /api/accounts/chain/order.
 *
 * @remarks
 * The body always carries every account id once. A 400 means the list no longer matches the
 * registered accounts.
 */
export async function setChainOrder(
  order: string[],
): Promise<{ ok: true; order: string[] } | { ok: false; error: string }> {
  const result = await http<{ order: string[] }>("/api/accounts/chain/order", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ order }),
  });
  if (result.ok) return { ok: true, order: result.data.order };
  if (result.status === 400) {
    return {
      ok: false,
      error: "The accounts changed. Reload and try the move again.",
    };
  }
  return { ok: false, error: "Couldn't save the account order." };
}

/**
 * Save part of the chain settings: PUT /api/accounts/chain/settings.
 *
 * @remarks
 * A 400 means a value was out of range.
 */
export async function setChainSettings(
  patch: Partial<ClaudeAccountsSettings>,
): Promise<
  { ok: true; settings: ClaudeAccountsSettings } | { ok: false; error: string }
> {
  const result = await http<ClaudeAccountsSettings>(
    "/api/accounts/chain/settings",
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    },
  );
  if (result.ok) return { ok: true, settings: result.data };
  if (result.status === 400) {
    return { ok: false, error: "That value is out of range." };
  }
  return { ok: false, error: "Couldn't save the setting." };
}

/**
 * Move to the next eligible account now: POST /api/accounts/chain/switch-now.
 *
 * @remarks
 * A 409 with the code `no-eligible-account` means every other account is limited or signed out.
 */
export async function switchNow(): Promise<
  { ok: true; to: string } | { ok: false; error: string }
> {
  const result = await http<{ to: string }>("/api/accounts/chain/switch-now", {
    method: "POST",
  });
  if (result.ok) return { ok: true, to: result.data.to };
  if (result.status === 409 && result.error === "no-eligible-account") {
    return {
      ok: false,
      error: "No other account can take over right now.",
    };
  }
  return { ok: false, error: "Couldn't switch the account." };
}

/**
 * Pin a session to its account or release it: PUT /api/cards/:id/session/account-pin.
 *
 * @remarks
 * A pinned session stays on its account when the chain moves.
 */
export async function setSessionPin(
  cardId: string,
  sessionId: string,
  pinned: boolean,
): Promise<{ ok: true; pinned: boolean } | { ok: false; error: string }> {
  const result = await http<{ pinned: boolean }>(
    `/api/cards/${encodeURIComponent(cardId)}/session/account-pin`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, pinned }),
    },
  );
  if (result.ok) return { ok: true, pinned: result.data.pinned };
  if (result.status === 404 || result.status === 400) {
    return { ok: false, error: "That session is no longer running." };
  }
  return { ok: false, error: "Couldn't change the pin." };
}
