import { Router } from "express";
import {
  DEFAULT_CLAUDE_ACCOUNT_ID,
  MAX_LOGIN_CODE_LEN,
} from "../../shared/types.js";
import {
  getActiveAccountId,
  isAccountId,
  readRegistry,
  setActiveAccount,
} from "../services/domain/claude-accounts.js";
import {
  listAccountSummaries,
  removeAccountAndLogout,
} from "../services/orchestration/claude-account-ops.js";
import {
  cancelLogin,
  getLoginView,
  startLogin,
  submitLoginCode,
} from "../services/orchestration/claude-login.js";
import { refreshUsageManually } from "../services/orchestration/claude-usage.js";

/**
 * Claude account routes, mounted behind the app-level remote gate like every `/api` router. No
 * handler ever returns a token, a config-dir path, or CLI output; ids are matched against the
 * registry before they touch the filesystem. Unexpected throws map to a generic 500.
 * @see docs/ARCHITECTURE.md#security-threat-model
 */
export const accountsRouter = Router();

function validateId(
  raw: unknown,
): { ok: true; id: string } | { ok: false; error: "invalid-id" } {
  if (raw === DEFAULT_CLAUDE_ACCOUNT_ID || isAccountId(raw)) {
    return { ok: true, id: raw };
  }
  return { ok: false, error: "invalid-id" };
}

accountsRouter.get("/accounts", async (_req, res) => {
  try {
    res.status(200).json({
      activeId: getActiveAccountId(),
      accounts: await listAccountSummaries(),
    });
  } catch {
    res.status(500).json({ error: "accounts-read-failed" });
  }
});

accountsRouter.put("/accounts/active", async (req, res) => {
  const body = req.body as { id?: unknown } | undefined;
  const idResult = validateId(body?.id);
  if (!idResult.ok) {
    res.status(400).json({ error: idResult.error });
    return;
  }
  try {
    const result = await setActiveAccount(idResult.id);
    if (!result.ok) {
      res.status(404).json({ error: result.error });
      return;
    }
    void refreshUsageManually(idResult.id).catch(() => undefined);
    res.status(200).json({ activeId: getActiveAccountId() });
  } catch {
    res.status(500).json({ error: "accounts-write-failed" });
  }
});

accountsRouter.get("/accounts/login", (_req, res) => {
  res.status(200).json(getLoginView());
});

accountsRouter.post("/accounts/login", async (req, res) => {
  const body = req.body as { accountId?: unknown } | undefined;
  let accountId: string | undefined;
  if (body?.accountId !== undefined) {
    if (!isAccountId(body.accountId)) {
      res.status(400).json({ error: "invalid-id" });
      return;
    }
    accountId = body.accountId;
  }
  try {
    const result = await startLogin(accountId);
    if (!result.ok) {
      res
        .status(result.error === "in-flight" ? 409 : 404)
        .json({ error: result.error });
      return;
    }
    res.status(202).json(getLoginView());
  } catch {
    res.status(500).json({ error: "login-start-failed" });
  }
});

accountsRouter.post("/accounts/login/code", (req, res) => {
  const body = req.body as { code?: unknown } | undefined;
  const raw = typeof body?.code === "string" ? body.code.trim() : "";
  if (raw === "" || raw.length > MAX_LOGIN_CODE_LEN || /[\r\n]/.test(raw)) {
    res.status(400).json({ error: "invalid-code" });
    return;
  }
  const result = submitLoginCode(raw);
  if (!result.ok) {
    res.status(409).json({ error: result.error });
    return;
  }
  res.status(200).json(getLoginView());
});

accountsRouter.delete("/accounts/login", async (_req, res) => {
  try {
    await cancelLogin();
    res.status(200).json(getLoginView());
  } catch {
    res.status(500).json({ error: "login-cancel-failed" });
  }
});

accountsRouter.post("/accounts/:id/usage/refresh", async (req, res) => {
  const idResult = validateId(req.params.id);
  if (!idResult.ok) {
    res.status(400).json({ error: idResult.error });
    return;
  }
  try {
    if (
      idResult.id !== DEFAULT_CLAUDE_ACCOUNT_ID &&
      !(await readRegistry()).some((a) => a.id === idResult.id)
    ) {
      res.status(404).json({ error: "not-found" });
      return;
    }
    const result = await refreshUsageManually(idResult.id);
    if (!result.ok) {
      res.status(429).json({ error: result.error });
      return;
    }
    res.status(200).json({ usage: result.usage });
  } catch {
    res.status(500).json({ error: "usage-refresh-failed" });
  }
});

accountsRouter.delete("/accounts/:id", async (req, res) => {
  const idResult = validateId(req.params.id);
  if (!idResult.ok) {
    res.status(400).json({ error: idResult.error });
    return;
  }
  if (idResult.id === DEFAULT_CLAUDE_ACCOUNT_ID) {
    res.status(400).json({ error: "default-account" });
    return;
  }
  try {
    const result = await removeAccountAndLogout(idResult.id);
    if (!result.ok) {
      res.status(404).json({ error: result.error });
      return;
    }
    res.status(200).json({ ok: true, activeId: getActiveAccountId() });
  } catch {
    res.status(500).json({ error: "accounts-write-failed" });
  }
});
