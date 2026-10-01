import assert from "node:assert/strict";
import { after, mock, test } from "node:test";
import { isolateEnv } from "../../test-support/fixtures.js";

const env = isolateEnv();
const TOKEN = ["g5", "fake", "sentry", "token"].join("-");
const { createKey, setValue, clearValue } = await import("./vault.js");
const { resolveSentryToken } = await import("./sentry-token.js");

after(() => env.cleanup());

test("an unregistered key resolves to null", async () => {
  assert.equal(await resolveSentryToken(), null);
});

test("a filled Vault value resolves trimmed and via the Vault", async () => {
  await createKey({ name: "SENTRY_TOKEN", purpose: "p" });
  await setValue("SENTRY_TOKEN", `  ${TOKEN}  `);
  assert.deepEqual(await resolveSentryToken(), { token: TOKEN, via: "vault" });
});

test("a cleared Vault value resolves to null", async () => {
  await clearValue("SENTRY_TOKEN");
  assert.equal(await resolveSentryToken(), null);
});

test("a value with a control character resolves to null", async () => {
  await setValue("SENTRY_TOKEN", `${TOKEN}\u0000x`);
  assert.equal(await resolveSentryToken(), null);
  await clearValue("SENTRY_TOKEN");
});

test("resolving never writes the token to the console", async () => {
  const lines: string[] = [];
  const capture = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  mock.method(console, "log", capture);
  mock.method(console, "warn", capture);
  mock.method(console, "error", capture);
  await setValue("SENTRY_TOKEN", TOKEN);
  assert.equal((await resolveSentryToken())?.token, TOKEN);
  mock.restoreAll();
  assert.ok(lines.every((l) => !l.includes(TOKEN)));
});
