import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import { isolateEnv } from "../../test-support/fixtures.js";

const env = isolateEnv();
const { createKey, clearValue, listKeys, readCurrent, readPrevious, setValue } =
  await import("./vault.js");

after(() => env.cleanup());

test("clearValue removes the value and keeps the key listed, not filled", async () => {
  await createKey({ name: "GITHUB_TOKEN", purpose: "gh purpose", value: "v1" });
  await createKey({ name: "OTHER", purpose: "other", value: "keep-me" });
  const result = await clearValue("GITHUB_TOKEN");
  assert.equal(result.ok, true);
  const keys = await listKeys();
  const github = keys.find((k) => k.name === "GITHUB_TOKEN");
  assert.equal(github?.filled, false);
  assert.equal(github?.purpose, "gh purpose");
  assert.deepEqual(await readCurrent("GITHUB_TOKEN"), {
    ok: false,
    error: "not-found",
  });
  assert.deepEqual(await readCurrent("OTHER"), { ok: true, value: "keep-me" });
  assert.equal(keys.find((k) => k.name === "OTHER")?.filled, true);
});

test("clearValue leaves a longer sibling name untouched", async () => {
  await createKey({ name: "GITHUB_TOKEN_EXTRA", purpose: "x", value: "sib" });
  await setValue("GITHUB_TOKEN", "v2");
  await clearValue("GITHUB_TOKEN");
  assert.deepEqual(await readCurrent("GITHUB_TOKEN_EXTRA"), {
    ok: true,
    value: "sib",
  });
});

test("clearValue keeps the schema line for the key", () => {
  const schema = fs.readFileSync(
    path.join(env.dispatchDir, "vault", "schema.keys"),
    "utf8",
  );
  assert.match(schema, /^GITHUB_TOKEN=\s+# gh purpose {2}\[empty\]$/m);
});

test("clearValue reports an unknown key", async () => {
  assert.deepEqual(await clearValue("MISSING_KEY"), {
    ok: false,
    error: "not-found",
  });
});

test("clearValue also forgets the replaced value", async () => {
  await createKey({ name: "PREV_TOKEN", purpose: "p", value: "old-value" });
  await setValue("PREV_TOKEN", "new-value");
  assert.deepEqual(await readPrevious("PREV_TOKEN"), {
    ok: true,
    value: "old-value",
  });
  await clearValue("PREV_TOKEN");
  assert.deepEqual(await readPrevious("PREV_TOKEN"), {
    ok: false,
    error: "not-found",
  });
  const key = (await listKeys()).find((k) => k.name === "PREV_TOKEN");
  assert.equal(key?.hasPrevious, false);
});
