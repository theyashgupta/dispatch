import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { isolateEnv } from "../../test-support/fixtures.js";
import { fakeBoardRepository } from "../../test-support/fake-board-repository.js";

const env = isolateEnv();
const { setBoardRepository } = await import("../../store/board-repository.js");
const accounts = await import("./claude-accounts.js");
const login = await import("./claude-login.js");

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

async function runWithCode(code: string, end: string): Promise<string> {
  assert.deepEqual(await login.startLogin(), { ok: true });
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
): Promise<void> {
  const before = events.length;
  const registryBefore = await registryEmails();
  const id = await runWithCode(code, "error");
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

void test.after(() => env.cleanup());
