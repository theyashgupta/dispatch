import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { isolateEnv } from "../../test-support/fixtures.js";
import { fakeBoardRepository } from "../../test-support/fake-board-repository.js";

const env = isolateEnv();
const { setBoardRepository } = await import("../../store/board-repository.js");
const accounts = await import("./claude-accounts.js");
const configHolder = await import("../infra/config-holder.js");
const login = await import("./claude-login.js");

configHolder.setOrchestrationConfig({ linearApiKey: "", port: 4700 });

const events: { type: string; reason: string; cardId: string | null }[] = [];
setBoardRepository(
  fakeBoardRepository({
    recordAccountEvent: (type, reason, cardId = null) => {
      events.push({ type, reason, cardId });
      return Promise.resolve();
    },
  }),
);

async function waitFor(state: string): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if (login.getLoginView().state === state) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(
    `login never reached ${state}, at ${login.getLoginView().state}`,
  );
}

async function runWithCode(
  code: string,
  end: string,
  opts: { managedDefault?: boolean } = {},
): Promise<string> {
  assert.deepEqual(await login.startLogin(undefined, opts), { ok: true });
  await waitFor("awaiting-code");
  const view = login.getLoginView();
  const id = view.state === "awaiting-code" ? view.accountId : "";
  assert.deepEqual(login.submitLoginCode(code), { ok: true });
  await waitFor(end);
  return id;
}

function errorMessage(): string {
  const view = login.getLoginView();
  return view.state === "error" ? view.message : `not error: ${view.state}`;
}

async function registryEmails(): Promise<string[]> {
  return (await accounts.readRegistry()).map((a) => a.email);
}

async function assertFailure(
  code: string,
  reason: string,
  message: string,
  opts: { managedDefault?: boolean } = {},
): Promise<void> {
  const before = events.length;
  const registryBefore = await registryEmails();
  const id = await runWithCode(code, "error", opts);
  assert.equal(errorMessage(), message);
  assert.deepEqual(events.slice(before), [
    { type: "account_login_failed", reason, cardId: null },
  ]);
  assert.deepEqual(await registryEmails(), registryBefore);
  assert.equal(fs.existsSync(accounts.accountDir(id)), false);
  await login.cancelLogin();
}

void test("a code without # is rejected with its own message and event", async () => {
  await assertFailure(
    "bad",
    "code-rejected",
    "Claude did not accept that code. Start again and paste the full code.",
  );
});

void test("a stale code that fails the token exchange with HTTP 400 is reported as rejected, not as a generic failure", async () => {
  await assertFailure(
    "stale",
    "code-rejected",
    "Claude did not accept that code. Start again and paste the full code.",
  );
});

void test("a CLI that exits non-zero with no known marker is a cli-failed login", async () => {
  await assertFailure(
    "crash",
    "cli-failed",
    "Claude login did not complete. Try again.",
  );
});

void test("access denied on the sign-in page emits access-denied", async () => {
  await assertFailure(
    "deny",
    "access-denied",
    "Sign-in was denied on the Claude page.",
  );
});

void test("a CLI that exits 0 with no identity emits no-identity", async () => {
  await assertFailure(
    "noid",
    "no-identity",
    "Claude reports no login for this account.",
  );
});

void test("a login whose identity is the home login is refused and not registered", async () => {
  await assertFailure("home", "home-login", "This is already your home login");
  assert.equal((await registryEmails()).includes("home@example.com"), false);
});

void test("a good login is registered and emits no failure event", async () => {
  const before = events.length;
  const id = await runWithCode("good", "done");
  const view = login.getLoginView();
  assert.equal(
    view.state === "done" && view.account.email,
    "second@example.com",
  );
  assert.deepEqual(await registryEmails(), ["second@example.com"]);
  assert.equal(fs.existsSync(accounts.accountDir(id)), true);
  assert.equal(events.length, before);
  await login.cancelLogin();
});

void test("a second login of an added account is refused as a duplicate and keeps the first record", async () => {
  await assertFailure(
    "good",
    "duplicate",
    "second@example.com is already added as a Claude account.",
  );
  assert.deepEqual(await registryEmails(), ["second@example.com"]);
});

void test("a cancel while the url is shown emits cancelled, removes the new dir and returns to idle", async () => {
  const before = events.length;
  assert.deepEqual(await login.startLogin(), { ok: true });
  await waitFor("awaiting-code");
  const view = login.getLoginView();
  const id = view.state === "awaiting-code" ? view.accountId : "";
  await login.cancelLogin();
  assert.equal(login.getLoginView().state, "idle");
  assert.deepEqual(events.slice(before), [
    { type: "account_login_failed", reason: "cancelled", cardId: null },
  ]);
  assert.equal(fs.existsSync(accounts.accountDir(id)), false);
  assert.deepEqual(await registryEmails(), ["second@example.com"]);
});

function registryOnDisk(): {
  defaultPosition: number;
  accounts: { id: string; position: number }[];
} {
  return JSON.parse(
    fs.readFileSync(
      path.join(env.dispatchDir, "claude-accounts", "accounts.json"),
      "utf8",
    ),
  ) as ReturnType<typeof registryOnDisk>;
}

function storedPointer(): unknown {
  return (
    JSON.parse(
      fs.readFileSync(path.join(env.dispatchDir, "config.json"), "utf8"),
    ) as Record<string, unknown>
  ).activeClaudeAccountId;
}

void test("a managed login with the home identity becomes the managed default at Default's position", async () => {
  const before = events.length;
  const id = await runWithCode("home", "done", { managedDefault: true });
  const view = login.getLoginView();
  assert.equal(view.state === "done" && view.account.managedDefault, true);
  assert.equal(view.state === "done" && view.account.isDefault, false);
  assert.equal(
    events.slice(before).some((e) => e.reason === "home-login"),
    false,
  );
  assert.equal(accounts.getManagedDefaultId(), id);
  const onDisk = registryOnDisk();
  assert.equal(
    onDisk.accounts.find((a) => a.id === id)?.position,
    onDisk.defaultPosition,
  );
  const order = await accounts.readChainOrder();
  assert.equal(order.includes("default"), false);
  assert.equal(order.includes(id), true);
  assert.equal(accounts.getActiveAccountId(), id);
  assert.equal(storedPointer(), id);

  assert.deepEqual(
    await login.startLogin(undefined, { managedDefault: true }),
    {
      ok: false,
      error: "managed-exists",
    },
  );
  await login.cancelLogin();

  assert.deepEqual(await login.startLogin(id), { ok: true });
  await waitFor("awaiting-code");
  assert.deepEqual(login.submitLoginCode("home"), { ok: true });
  await waitFor("done");
  assert.equal(accounts.getManagedDefaultId(), id);
  assert.equal(
    events.slice(before).some((e) => e.reason === "home-login"),
    false,
  );
  await login.cancelLogin();

  assert.deepEqual(await accounts.removeAccount(id), { ok: true });
  assert.equal(accounts.getManagedDefaultId(), undefined);
});

void test("a managed login with another identity is refused and leaves no trace", async () => {
  const registryBefore = await registryEmails();
  const pointerBefore = storedPointer();
  await assertFailure(
    "good",
    "not-home-identity",
    "Sign in with the same Claude account as your terminal login (home@example.com).",
    { managedDefault: true },
  );
  assert.equal(accounts.getManagedDefaultId(), undefined);
  assert.deepEqual(await registryEmails(), registryBefore);
  assert.equal(storedPointer(), pointerBefore);
});

const OTHER_HOME = JSON.stringify({
  loggedIn: true,
  email: "moved@example.com",
  orgId: "org-moved",
  orgName: "Moved Org",
  subscriptionType: "max",
});
const ORIGINAL_HOME = JSON.stringify({
  loggedIn: true,
  email: "home@example.com",
  orgId: "org-home",
  orgName: "Home Org",
  subscriptionType: "max",
});

async function relogin(id: string, code: string, end: string): Promise<void> {
  assert.deepEqual(await login.startLogin(id), { ok: true });
  await waitFor("awaiting-code");
  assert.deepEqual(login.submitLoginCode(code), { ok: true });
  await waitFor(end);
}

void test("a managed re-login is checked against its own record, not the current home login", async () => {
  const id = await runWithCode("home", "done", { managedDefault: true });
  await login.cancelLogin();
  const homeFile = path.join(env.root, "moved-home.json");
  const loginFile = path.join(env.root, "login-identity.json");
  fs.writeFileSync(homeFile, OTHER_HOME);
  fs.writeFileSync(loginFile, ORIGINAL_HOME);
  process.env.FAKE_CLAUDE_IDENTITY_FILE = homeFile;
  process.env.FAKE_CLAUDE_LOGIN_IDENTITY_FILE = loginFile;
  try {
    await relogin(id, "good", "done");
    assert.equal(accounts.getManagedDefaultId(), id);
    await login.cancelLogin();

    fs.rmSync(loginFile);
    await relogin(id, "good", "error");
    assert.equal(
      errorMessage(),
      "Sign in with the same Claude account as your terminal login (home@example.com).",
    );
    await login.cancelLogin();
  } finally {
    delete process.env.FAKE_CLAUDE_IDENTITY_FILE;
    delete process.env.FAKE_CLAUDE_LOGIN_IDENTITY_FILE;
    await accounts.removeAccount(id);
  }
});

void test("with a managed default, a login of the home identity is a duplicate, not a home login", async () => {
  const id = await runWithCode("home", "done", { managedDefault: true });
  await login.cancelLogin();
  try {
    await assertFailure(
      "home",
      "duplicate",
      "home@example.com is already added as a Claude account.",
    );
  } finally {
    await accounts.removeAccount(id);
  }
});

void test("a managed login lets the chain forget the stale default entry", async () => {
  let forgotten = 0;
  login.onManagedDefaultAdopted(() => {
    forgotten += 1;
    return Promise.resolve();
  });
  const id = await runWithCode("home", "done", { managedDefault: true });
  await login.cancelLogin();
  assert.equal(forgotten, 1);
  await accounts.removeAccount(id);
});

void test("removing the account during a managed re-login cancels it instead of adopting", async () => {
  const id = await runWithCode("home", "done", { managedDefault: true });
  await login.cancelLogin();
  const before = events.length;
  assert.deepEqual(await login.startLogin(id), { ok: true });
  await waitFor("awaiting-code");
  assert.deepEqual(await accounts.removeAccount(id), { ok: true });
  assert.deepEqual(login.submitLoginCode("home"), { ok: true });
  await waitFor("idle");
  assert.deepEqual(events.slice(before), [
    { type: "account_login_failed", reason: "cancelled", cardId: null },
  ]);
  assert.equal(accounts.getManagedDefaultId(), undefined);
  assert.equal((await registryEmails()).includes("home@example.com"), false);
});

void test.after(() => env.cleanup());
