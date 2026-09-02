import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { REAL_AUTH_STATUS_JSON } from "../test-support/claude-transcripts.js";
import { isolateEnv } from "../test-support/fixtures.js";

const env = isolateEnv();
const cli = await import("./claude-cli.js");

void test("readClaudeIdentity maps the recorded real auth status payload and ignores its extra keys", async () => {
  const dir = path.join(env.root, "identity-real");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, ".fake-login"), REAL_AUTH_STATUS_JSON);
  const identity = await cli.readClaudeIdentity(dir);
  assert.deepEqual(identity, {
    loggedIn: true,
    email: "someone@example.com",
    orgId: "876beadb-c8c2-4059-bd8b-000000000000",
    orgName: "someone@example.com's Organization",
    subscriptionType: "max",
  });
  const parsed = JSON.parse(REAL_AUTH_STATUS_JSON) as Record<string, unknown>;
  for (const key of [
    "loggedIn",
    "email",
    "orgId",
    "orgName",
    "subscriptionType",
  ]) {
    assert.ok(key in parsed, `real payload carries ${key}`);
  }
});

void test("readClaudeIdentity is logged out for a dir without a login and for a missing binary", async () => {
  const dir = path.join(env.root, "identity-none");
  fs.mkdirSync(dir, { recursive: true });
  const none = await cli.readClaudeIdentity(dir);
  assert.equal(none.loggedIn, false);
  assert.equal(none.email, "");
  const home = await cli.readClaudeIdentity();
  assert.equal(home.loggedIn, true);
  assert.equal(home.email, "home@example.com");
  const previousPath = process.env.PATH;
  process.env.PATH = path.join(env.root, "empty-bin");
  const missing = await cli.readClaudeIdentity(dir);
  process.env.PATH = previousPath;
  assert.equal(missing.loggedIn, false);
});

void test.after(() => env.cleanup());
