import { Router } from "express";
import { SWITCH_NOW_REASON } from "../../shared/account-chain.js";
import {
  DEFAULT_CLAUDE_ACCOUNT_ID,
  type AccountSwitchResponse,
} from "../../shared/types.js";
import {
  getActiveAccountId,
  readRegistry,
  setActiveAccount,
  setChainOrder,
} from "../services/orchestration/claude-accounts.js";
import {
  listAccountSessions,
  listAccountSummaries,
  readChainView,
  removeAccountAndLogout,
} from "../services/orchestration/claude-account-ops.js";
import {
  requestFailover,
  noteManualSwitch,
  runInChainQueue,
  updateChainSettings,
} from "../services/orchestration/account-chain.js";
import { getClaudeAccountsSettings } from "../services/infra/config-holder.js";
import { applyAccountChoice } from "../services/orchestration/session-account-apply.js";
import {
  cancelLogin,
  getLoginView,
  startLogin,
  submitLoginCode,
} from "../services/orchestration/claude-login.js";
import { refreshUsageManually } from "../services/orchestration/claude-usage.js";
import {
  ConflictError,
  HttpError,
  NotFoundError,
  ValidationError,
} from "../services/domain/errors.js";
import {
  accountOrDefaultIdSchema,
  activeBodySchema,
  chainOrderBodySchema,
  chainSettingsBodySchema,
  loginBodySchema,
  loginCodeBodySchema,
  removableAccountIdSchema,
} from "./accounts-schemas.js";
import { httpErrorHandler, orFail } from "./error-handler.js";
import { parseOrThrow } from "./parse-input.js";

/**
 * Claude account routes, mounted behind the app-level remote gate like every `/api` router. No
 * handler ever returns a token, a config-dir path, or CLI output; ids are matched against the
 * registry before they touch the filesystem. Unexpected throws map to a generic 500.
 * @see docs/ARCHITECTURE.md#security-threat-model
 */
export const accountsRouter = Router();

accountsRouter.get("/accounts", async (_req, res) => {
  const body = await orFail("accounts-read-failed", async () => ({
    activeId: getActiveAccountId(),
    accounts: await listAccountSummaries(),
    sessions: await listAccountSessions(),
    chain: await readChainView(),
  }));
  res.status(200).json(body);
});

accountsRouter.put("/accounts/active", async (req, res) => {
  const { id, applyToRunning } = parseOrThrow(activeBodySchema, req.body);
  const outcome = await runInChainQueue(async () => {
    const result = await orFail("accounts-write-failed", () =>
      setActiveAccount(id),
    );
    if (!result.ok) return result;
    await noteManualSwitch();
    void refreshUsageManually(id).catch(() => undefined);
    const applied = await orFail("accounts-apply-failed", () =>
      applyAccountChoice(applyToRunning, id),
    );
    return { ok: true as const, applied };
  });
  if (!outcome.ok) throw new NotFoundError(outcome.error);
  const body: AccountSwitchResponse = {
    activeId: getActiveAccountId(),
    ...outcome.applied,
  };
  res.status(200).json(body);
});

accountsRouter.put("/accounts/chain/order", async (req, res) => {
  const { order } = parseOrThrow(chainOrderBodySchema, req.body);
  const result = await orFail("accounts-write-failed", () =>
    setChainOrder(order),
  );
  if (!result.ok) throw new ValidationError(result.error);
  res.status(200).json({ order: result.order });
});

accountsRouter.put("/accounts/chain/settings", async (req, res) => {
  const patch = parseOrThrow(chainSettingsBodySchema, req.body);
  await orFail("settings-write-failed", () => updateChainSettings(patch));
  res.status(200).json(getClaudeAccountsSettings());
});

accountsRouter.post("/accounts/chain/switch-now", async (_req, res) => {
  const result = await orFail("switch-now-failed", () =>
    requestFailover(SWITCH_NOW_REASON),
  );
  if (!result.ok) throw new ConflictError(result.error);
  res.status(200).json({ to: result.to, moves: result.moves });
});

accountsRouter.get("/accounts/login", (_req, res) => {
  res.status(200).json(getLoginView());
});

accountsRouter.post("/accounts/login", async (req, res) => {
  const { accountId } = parseOrThrow(loginBodySchema, req.body);
  const result = await orFail("login-start-failed", () =>
    startLogin(accountId),
  );
  if (!result.ok) {
    throw new HttpError(result.error === "in-flight" ? 409 : 404, result.error);
  }
  res.status(202).json(getLoginView());
});

accountsRouter.post("/accounts/login/code", (req, res) => {
  const { code } = parseOrThrow(loginCodeBodySchema, req.body);
  const result = submitLoginCode(code);
  if (!result.ok) throw new ConflictError(result.error);
  res.status(200).json(getLoginView());
});

accountsRouter.delete("/accounts/login", async (_req, res) => {
  await orFail("login-cancel-failed", cancelLogin);
  res.status(200).json(getLoginView());
});

accountsRouter.post("/accounts/:id/usage/refresh", async (req, res) => {
  const id = parseOrThrow(accountOrDefaultIdSchema, req.params.id);
  const known = await orFail(
    "usage-refresh-failed",
    async () =>
      id === DEFAULT_CLAUDE_ACCOUNT_ID ||
      (await readRegistry()).some((a) => a.id === id),
  );
  if (!known) throw new NotFoundError("not-found");
  const result = await orFail("usage-refresh-failed", () =>
    refreshUsageManually(id),
  );
  if (!result.ok) throw new HttpError(429, result.error);
  res.status(200).json({ usage: result.usage });
});

accountsRouter.delete("/accounts/:id", async (req, res) => {
  const id = parseOrThrow(removableAccountIdSchema, req.params.id);
  const result = await orFail("accounts-write-failed", () =>
    removeAccountAndLogout(id),
  );
  if (!result.ok) throw new NotFoundError(result.error);
  res.status(200).json({ ok: true, activeId: getActiveAccountId() });
});

accountsRouter.use(httpErrorHandler);
