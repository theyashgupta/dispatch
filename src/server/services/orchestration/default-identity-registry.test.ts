import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { isolateEnv } from "../../test-support/fixtures.js";

isolateEnv();
const accounts = await import("./claude-accounts.js");
const { CLAUDE_ACCOUNTS_REGISTRY_PATH } = await import("../infra/paths.js");

const ID = "11111111-1111-4111-8111-111111111111";
const record = {
  id: ID,
  email: "x@example.com",
  orgId: "org",
  orgName: "Org",
  subscriptionType: "max",
  createdAt: "2026-10-01T00:00:00.000Z",
  lastLoginAt: "2026-10-01T00:00:00.000Z",
};
const identity = { email: "home@example.com", orgId: "org-home" };

const file = () =>
  JSON.parse(fs.readFileSync(CLAUDE_ACCOUNTS_REGISTRY_PATH, "utf8")) as {
    version: number;
    accounts: unknown[];
    defaultIdentity?: unknown;
  };

void test("defaultIdentity survives upsert and remove, and accounts survive an identity write", async () => {
  assert.equal(await accounts.readDefaultIdentity(), undefined);
  await accounts.writeDefaultIdentity(identity);
  assert.deepEqual(file().defaultIdentity, identity);

  await accounts.upsertAccount(record);
  assert.deepEqual(file().defaultIdentity, identity);
  assert.equal(file().accounts.length, 1);

  await accounts.writeDefaultIdentity({
    email: "new@example.com",
    orgId: "o2",
  });
  assert.equal(file().accounts.length, 1);
  assert.deepEqual(await accounts.readDefaultIdentity(), {
    email: "new@example.com",
    orgId: "o2",
  });

  fs.mkdirSync(accounts.accountDir(ID), { recursive: true });
  assert.deepEqual(await accounts.removeAccount(ID), { ok: true });
  assert.deepEqual(file().defaultIdentity, {
    email: "new@example.com",
    orgId: "o2",
  });
  assert.equal(file().accounts.length, 0);
  assert.equal(file().version, 2);
});
