import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { isolateEnv } from "../../test-support/fixtures.js";

const env = isolateEnv();
const accounts = await import("../domain/claude-accounts.js");
const login = await import("./claude-login.js");

const registryPath = path.join(
  env.dispatchDir,
  "claude-accounts",
  "accounts.json",
);

async function waitFor(state: string, tries = 50): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (login.getLoginView().state === state) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(
    `login never reached ${state}, at ${login.getLoginView().state}`,
  );
}

async function startToAwaiting(): Promise<string> {
  assert.deepEqual(await login.startLogin(), { ok: true });
  await waitFor("awaiting-code");
  const view = login.getLoginView();
  assert.equal(view.state, "awaiting-code");
  return view.state === "awaiting-code" ? view.accountId : "";
}

function errorMessage(): string {
  const view = login.getLoginView();
  return view.state === "error" ? view.message : `not error: ${view.state}`;
}

void test("access denied on the sign-in page ends in its own error and removes the fresh dir", async () => {
  const id = await startToAwaiting();
  assert.deepEqual(login.submitLoginCode("deny"), { ok: true });
  await waitFor("error");
  assert.equal(errorMessage(), "Sign-in was denied on the Claude page.");
  assert.equal(fs.existsSync(accounts.accountDir(id)), false);
  await login.cancelLogin();
});

void test("a CLI that exits 0 without an identity is reported, never registered", async () => {
  const id = await startToAwaiting();
  assert.deepEqual(login.submitLoginCode("noid"), { ok: true });
  await waitFor("error");
  assert.equal(errorMessage(), "Claude reports no login for this account.");
  assert.equal(fs.existsSync(accounts.accountDir(id)), false);
  assert.equal(
    (await accounts.readRegistry()).some((a) => a.id === id),
    false,
  );
  await login.cancelLogin();
});

void test("a throw while saving the login is caught, reported, and leaves no dir", async () => {
  const id = await startToAwaiting();
  fs.writeFileSync(registryPath, '{"accounts":[{"nope":1}]}');
  assert.deepEqual(login.submitLoginCode("good"), { ok: true });
  await waitFor("error");
  fs.writeFileSync(registryPath, '{"version":1,"accounts":[]}');
  assert.equal(errorMessage(), "Claude login could not be saved. Try again.");
  assert.equal(fs.existsSync(accounts.accountDir(id)), false);
  await login.cancelLogin();
});

void test("the login timeout (DISPATCH_LOGIN_TIMEOUT_MS) kills a login the user walked away from", async () => {
  process.env.DISPATCH_LOGIN_TIMEOUT_MS = "700";
  const id = await startToAwaiting();
  delete process.env.DISPATCH_LOGIN_TIMEOUT_MS;
  const t0 = Date.now();
  await waitFor("error", 40);
  assert.ok(
    Date.now() - t0 < 3_000,
    "timed out within a few tenths of a second",
  );
  assert.equal(errorMessage(), "Claude login did not complete. Try again.");
  assert.equal(fs.existsSync(accounts.accountDir(id)), false);
  await login.cancelLogin();
  assert.equal(login.getLoginView().state, "idle");
});

void test.after(() => env.cleanup());
