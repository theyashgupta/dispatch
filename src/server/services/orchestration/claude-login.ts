import { randomUUID } from "node:crypto";
import type { ClaudeLoginView } from "../../../shared/types.js";
import {
  claudeBinaryPath,
  logoutClaudeConfigDir,
  readClaudeIdentity,
} from "../../adapters/claude-cli.js";
import {
  spawnClaudeLogin,
  type LoginProcess,
} from "../../adapters/claude-login.js";
import {
  accountDir,
  materializeConfigDir,
  readRegistry,
  removeConfigDir,
  upsertAccount,
  type ClaudeAccountRecord,
} from "../domain/claude-accounts.js";
import { getUsage, refreshUsage } from "./claude-usage.js";

const LOGIN_TIMEOUT_MS = 180_000;

interface ActiveLogin {
  accountId: string;
  isNew: boolean;
  process: LoginProcess;
  timer: NodeJS.Timeout;
  finished: boolean;
  codeRejected: boolean;
  cancelRequested: boolean;
}

let view: ClaudeLoginView = { state: "idle" };
let active: ActiveLogin | null = null;
let cancelledStartId: string | null = null;

/**
 * The login state for the wire: never the pasted code, never CLI output beyond the url.
 */
export function getLoginView(): ClaudeLoginView {
  return view;
}

function inFlight(): boolean {
  return (
    view.state === "starting" ||
    view.state === "awaiting-code" ||
    view.state === "finishing"
  );
}

async function cleanupNewDir(login: ActiveLogin): Promise<void> {
  if (login.isNew) await removeConfigDir(login.accountId);
}

async function fail(login: ActiveLogin, message: string): Promise<void> {
  await cleanupNewDir(login);
  view = { state: "error", message };
}

async function settle(
  login: ActiveLogin,
  code: number | null,
  accessDenied: boolean,
): Promise<void> {
  if (code !== 0) {
    await fail(
      login,
      login.codeRejected
        ? "Claude did not accept that code. Start again and paste the full code."
        : accessDenied
          ? "Sign-in was denied on the Claude page."
          : "Claude login did not complete. Try again.",
    );
    return;
  }

  view = { state: "finishing", accountId: login.accountId };
  const dir = accountDir(login.accountId);
  const identity = await readClaudeIdentity(dir);
  if (!identity.loggedIn || identity.email === "") {
    await fail(login, "Claude reports no login for this account.");
    return;
  }

  const existing = await readRegistry();
  const duplicate = existing.find(
    (a) =>
      a.id !== login.accountId &&
      a.email === identity.email &&
      a.orgId === identity.orgId,
  );
  if (duplicate) {
    await logoutClaudeConfigDir(dir);
    await fail(
      login,
      `${identity.email} is already added as a Claude account.`,
    );
    return;
  }
  if (login.cancelRequested) {
    await logoutClaudeConfigDir(dir);
    await cleanupNewDir(login);
    view = { state: "idle" };
    return;
  }

  const now = new Date().toISOString();
  const prior = existing.find((a) => a.id === login.accountId);
  const record: ClaudeAccountRecord = {
    id: login.accountId,
    email: identity.email,
    orgId: identity.orgId,
    orgName: identity.orgName,
    subscriptionType: identity.subscriptionType,
    createdAt: prior?.createdAt ?? now,
    lastLoginAt: now,
  };
  await upsertAccount(record);
  await refreshUsage(record.id).catch(() => undefined);
  view = {
    state: "done",
    account: {
      id: record.id,
      email: record.email,
      orgName: record.orgName,
      subscriptionType: record.subscriptionType,
      isDefault: false,
      lastLoginAt: record.lastLoginAt,
      usage: getUsage(record.id),
    },
  };
}

/**
 * Run the post-exit work for a login exactly once, keep `active` set until it is over so a cancel
 * during `finishing` is honoured, and never let a rejection escape (an unhandled one would take the
 * whole process down).
 */
async function finish(
  login: ActiveLogin,
  code: number | null,
  accessDenied: boolean,
): Promise<void> {
  if (login.finished) return;
  login.finished = true;
  clearTimeout(login.timer);
  try {
    await settle(login, code, accessDenied);
  } catch {
    await fail(login, "Claude login could not be saved. Try again.").catch(
      () => undefined,
    );
  } finally {
    if (active === login) active = null;
  }
}

/**
 * Start a Claude login for a fresh account, or for an existing id to repair its token. Exactly one
 * login runs at a time; the browser is opened by the CLI itself and the url is also exposed for a
 * remote user.
 * @remarks The slot is reserved synchronously before the first await, otherwise two requests in
 * one tick both pass the in-flight check and spawn two CLI children (React's dev double-effect
 * did exactly that). A cancel that lands during the setup awaits is remembered and honoured right
 * after the spawn. A re-login logs the dir out first so the CLI does not short-circuit on the
 * stale token. The 180 second timer is the only thing that ends a login the user walked away from.
 */
export async function startLogin(
  accountId?: string,
): Promise<{ ok: true } | { ok: false; error: "in-flight" | "not-found" }> {
  if (inFlight()) return { ok: false, error: "in-flight" };
  const isNew = accountId === undefined;
  const id = accountId ?? randomUUID();
  view = { state: "starting", accountId: id };
  cancelledStartId = null;

  let dir: string;
  let claudePath: string;
  try {
    if (!isNew) {
      const known = (await readRegistry()).some((a) => a.id === id);
      if (!known) {
        view = { state: "idle" };
        return { ok: false, error: "not-found" };
      }
    }
    dir = await materializeConfigDir(id);
    claudePath = await claudeBinaryPath();
    if (!isNew) await logoutClaudeConfigDir(dir);
  } catch (err) {
    if (isNew) await removeConfigDir(id);
    view = { state: "idle" };
    throw err;
  }
  if (cancelledStartId === id) {
    cancelledStartId = null;
    if (isNew) await removeConfigDir(id);
    view = { state: "idle" };
    return { ok: true };
  }

  const login: ActiveLogin = {
    accountId: id,
    isNew,
    finished: false,
    codeRejected: false,
    cancelRequested: false,
    timer: setTimeout(
      () => {
        login.process.kill();
      },
      Number(process.env.DISPATCH_LOGIN_TIMEOUT_MS) || LOGIN_TIMEOUT_MS,
    ),
    process: spawnClaudeLogin(claudePath, dir, {
      onUrl(url) {
        if (active === login && view.state === "starting") {
          view = { state: "awaiting-code", accountId: id, url };
        }
      },
      onInvalidCode() {
        if (active === login) {
          login.codeRejected = true;
          login.process.kill();
        }
      },
    }),
  };
  login.timer.unref();
  active = login;
  void login.process.exited
    .then(({ code, accessDenied }) => finish(login, code, accessDenied))
    .catch(() => undefined);
  return { ok: true };
}

/**
 * Hand the pasted sign-in code to the waiting CLI. Only valid while the url has been shown.
 */
export function submitLoginCode(
  code: string,
): { ok: true } | { ok: false; error: "not-awaiting" } {
  if (!active || view.state !== "awaiting-code") {
    return { ok: false, error: "not-awaiting" };
  }
  active.process.submitCode(code);
  view = { state: "finishing", accountId: active.accountId };
  return { ok: true };
}

/**
 * Abort an in-flight login or clear a finished one back to idle. A fresh account's dir is removed.
 * A cancel during the setup awaits or during `finishing` is recorded and applied by the login
 * itself, so no child or registry record survives it.
 */
export async function cancelLogin(): Promise<void> {
  const login = active;
  if (login) {
    login.cancelRequested = true;
    if (!login.finished) {
      login.finished = true;
      clearTimeout(login.timer);
      active = null;
      login.process.kill();
      await login.process.exited;
      await cleanupNewDir(login);
    } else {
      return;
    }
  } else if (view.state === "starting") {
    cancelledStartId = view.accountId;
  }
  view = { state: "idle" };
}
