import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, beforeEach, mock, test } from "node:test";
import { isolateEnv } from "../../test-support/fixtures.js";

const env = isolateEnv();
const ghPath = path.join(env.binDir, "gh");
const { createKey, setValue, clearValue } = await import("../infra/vault.js");
const { resolveGithubToken } = await import("./github-token.js");

after(() => env.cleanup());

function fakeGh(script: string): void {
  fs.writeFileSync(ghPath, `#!/bin/sh\n${script}\n`, { mode: 0o755 });
}

beforeEach(() => {
  fakeGh(
    '[ "$1 $2" = "auth token" ] && echo g5-fake-gh-token && exit 0\nexit 1',
  );
});

test("an empty Vault falls back to the gh login", async () => {
  assert.deepEqual(await resolveGithubToken(), {
    token: "g5-fake-gh-token",
    via: "gh",
  });
});

test("a filled Vault value wins over gh", async () => {
  await createKey({ name: "GITHUB_TOKEN", purpose: "p" });
  await setValue("GITHUB_TOKEN", "  g5-fake-vault-token  ");
  assert.deepEqual(await resolveGithubToken(), {
    token: "g5-fake-vault-token",
    via: "vault",
  });
});

test("a cleared Vault value falls back to gh again", async () => {
  await clearValue("GITHUB_TOKEN");
  assert.equal((await resolveGithubToken())?.via, "gh");
});

test("no Vault value and a failing gh resolve to null", async () => {
  fakeGh("echo 'not logged in' >&2\nexit 1");
  assert.equal(await resolveGithubToken(), null);
});

test("gh printing only whitespace resolves to null", async () => {
  fakeGh("echo '   '");
  assert.equal(await resolveGithubToken(), null);
});

test("a Vault value with a control character resolves to null", async () => {
  await setValue("GITHUB_TOKEN", ["g5", "fake", "vault"].join("-") + "\u0000x");
  assert.equal(await resolveGithubToken(), null);
  await clearValue("GITHUB_TOKEN");
});

test("resolving never writes the token to the console", async () => {
  const lines: string[] = [];
  const capture = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  const log = mock.method(console, "log", capture);
  const warn = mock.method(console, "warn", capture);
  const error = mock.method(console, "error", capture);
  await resolveGithubToken();
  fakeGh("echo g5-fake-gh-token >&2\nexit 1");
  await resolveGithubToken();
  log.mock.restore();
  warn.mock.restore();
  error.mock.restore();
  assert.ok(lines.every((l) => !l.includes("g5-fake")));
});
