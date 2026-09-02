import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { isolateEnv } from "../test-support/fixtures.js";

const env = isolateEnv();
const { preSeedTrust } = await import("./claude-trust.js");

function projects(file: string): Record<string, unknown> {
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as {
    projects?: Record<string, unknown>;
  };
  return parsed.projects ?? {};
}

void test("preSeedTrust writes into the account config dir and leaves the home file alone", async () => {
  const home = path.join(env.home, ".claude.json");
  const dir = path.join(env.root, "acct");
  fs.mkdirSync(dir);
  fs.writeFileSync(
    path.join(dir, ".claude.json"),
    JSON.stringify({ theme: "dark" }),
  );
  const before = fs.readFileSync(home, "utf8");

  assert.equal(await preSeedTrust("/work/ws-1", dir), true);
  assert.equal(
    (
      projects(path.join(dir, ".claude.json"))["/work/ws-1"] as {
        hasTrustDialogAccepted: boolean;
      }
    ).hasTrustDialogAccepted,
    true,
  );
  assert.equal(fs.readFileSync(home, "utf8"), before);

  assert.equal(await preSeedTrust("/work/ws-2"), true);
  assert.equal(
    (projects(home)["/work/ws-2"] as { hasTrustDialogAccepted: boolean })
      .hasTrustDialogAccepted,
    true,
  );
  assert.equal("/work/ws-2" in projects(path.join(dir, ".claude.json")), false);
});

void test("preSeedTrust returns false without writing when the target file is missing", async () => {
  const dir = path.join(env.root, "empty-acct");
  fs.mkdirSync(dir);
  assert.equal(await preSeedTrust("/work/ws-3", dir), false);
  assert.equal(fs.existsSync(path.join(dir, ".claude.json")), false);
});
