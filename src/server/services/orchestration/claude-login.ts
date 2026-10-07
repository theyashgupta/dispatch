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
} from "./claude-accounts.js";
import { getUsage, refreshUsage } from "./claude-usage.js";
import { boardRepository } from "../../store/board-repository.js";

const LOGIN_TIMEOUT_MS = 600_000;

type LoginFailure =
  | "code-rejected"
  | "access-denied"
  | "timeout"
  | "cli-failed"
  | "no-identity"
  | "duplicate"
  | "home-login"
  | "save-failed"
  | "cancelled";

interface ActiveLogin {
  accountId: string;
  isNew: boolean;
  process: LoginProcess;
  timer: NodeJS.Timeout;
  finished: boolean;
  codeRejected: boolean;
  timedOut: boolean;
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

function recordFailure(reason: LoginFailure): Promise<void> {
  return boardRepository.recordAccountEvent("account_login_failed", reason);
}

async function fail(
  login: ActiveLogin,
  reason: LoginFailure,
  message: string,
): Promise<void> {
  await cleanupNewDir(login);
  view = { state: "error", message };
  await recordFailure(reason);
}

function exitFailure(
  login: ActiveLogin,
  accessDenied: boolean,
): [LoginFailure, string] {
  if (login.codeRejected) {
    return [
      "code-rejected",
      "Claude did not accept that code. Start again and paste the full code.",
    ];
  }
  if (accessDenied) {
    return ["access-denied", "Sign-in was denied on the Claude page."];
  }
  if (login.timedOut) {
    return [
      "timeout",
      "The sign-in took too long and was stopped. Start again.",
    ];
  }
  return ["cli-failed", "Claude login did not complete. Try again."];
}

function sameIdentity(
  a: { email: string; orgId: string },
  b: { email: string; orgId: string },
): boolean {
  return a.email === b.email && a.orgId === b.orgId;
}

async function settle(
  login: ActiveLogin,
  code: number | null,
  accessDenied: boolean,
): Promise<void> {
  if (code !== 0) {
    await fail(login, ...exitFailure(login, accessDenied));
    return;
  }

  view = { state: "finishing", accountId: login.accountId };
  const dir = accountDir(login.accountId);
  const identity = await readClaudeIdentity(dir);
  if (!identity.loggedIn || identity.email === "") {
    await fail(
      login,
      "no-identity",
      "Claude reports no login for this account.",
    );
    return;
  }

  const home = await readClaudeIdentity();
  if (home.loggedIn && sameIdentity(home, identity)) {
    await logoutClaudeConfigDir(dir);
    await fail(login, "home-login", "This is already your home login");
    return;
  }
  const existing = await readRegistry();
  const duplicate = existing.find(
    (a) => a.id !== login.accountId && sameIdentity(a, identity),
  );
  if (duplicate) {
    await logoutClaudeConfigDir(dir);
    await fail(
      login,
      "duplicate",
      `${identity.email} is already added as a Claude account.`,
    );
    return;
  }
  if (login.cancelRequested) {
    await logoutClaudeConfigDir(dir);
    await cleanupNewDir(login);
    view = { state: "idle" };
    await recordFailure("cancelled");
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
    await fail(
      login,
      "save-failed",
      "Claude login could not be saved. Try again.",
    ).catch(() => undefined);
  } finally {
    if (active === login) active = null;
  }
}

/**
 * Start a Claude login for a fresh account, or for an existing id to repair its token.
 *
 * @remarks The slot is reserved synchronously before the first await, otherwise two requests in
 * one tick both pass the in-flight check and spawn two CLI children (React's dev double-effect
 * did exactly that). A re-login logs the dir out first so the CLI does not short-circuit on the
 * stale token. The 10 minute timer is the only thing that ends an abandoned login and leaves time
 * to switch the Claude account in the browser, which 180 seconds did not.
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
    timedOut: false,
    cancelRequested: false,
    timer: setTimeout(
      () => {
        login.timedOut = true;
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
 * Abort an in-flight login or clear a finished one back to idle.
 *
 * @remarks A cancel during the setup awaits or during `finishing` is recorded and applied by the
 * login itself, so no child or registry record survives it. Aborting a running CLI records a
 * `cancelled` login failure, so a dialog closed by accident shows in the activity feed.
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
      await recordFailure("cancelled");
    } else {
      return;
    }
  } else if (view.state === "starting") {
    cancelledStartId = view.accountId;
  }
  view = { state: "idle" };
}
