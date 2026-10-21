import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { isolateEnv } from "../../test-support/fixtures.js";

const env = isolateEnv();
const { envVaultPresence } = await import("./vault.js");

after(() => env.cleanup());

const NAMES = ["PUSHOVER_USER_KEY", "PUSHOVER_APP_TOKEN"] as const;

function files(schema: string | null, values: string | null) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pushover-"));
  const paths = {
    schema: path.join(dir, "schema.keys"),
    values: path.join(dir, "values.env"),
  };
  if (schema !== null) fs.writeFileSync(paths.schema, schema);
  if (values !== null) fs.writeFileSync(paths.values, values);
  return paths;
}

const userOnly = (values: string) =>
  envVaultPresence(["PUSHOVER_USER_KEY"], {}, files(null, values));

void test("a name defined in the environment is filled even when the values file is empty", async () => {
  const result = await envVaultPresence(
    NAMES,
    {
      PUSHOVER_USER_KEY: "fake-user-168",
      PUSHOVER_APP_TOKEN: "fake-token-168",
    },
    files(null, "PUSHOVER_USER_KEY=''\n"),
  );
  assert.deepEqual(result, {
    PUSHOVER_USER_KEY: "filled",
    PUSHOVER_APP_TOKEN: "filled",
  });
});

void test("an empty or blank environment value is empty", async () => {
  for (const blank of ["", "   "]) {
    const result = await envVaultPresence(
      NAMES,
      { PUSHOVER_USER_KEY: blank },
      files(null, null),
    );
    assert.equal(result.PUSHOVER_USER_KEY, "empty");
    assert.equal(result.PUSHOVER_APP_TOKEN, "unset");
  }
});

void test("a bare schema name with no values line is empty", async () => {
  const result = await envVaultPresence(
    NAMES,
    {},
    files("# Pushover app token\nPUSHOVER_APP_TOKEN\n", null),
  );
  assert.equal(result.PUSHOVER_APP_TOKEN, "empty");
  assert.equal(result.PUSHOVER_USER_KEY, "unset");
});

void test("a schema line with a purpose comment is empty", async () => {
  const result = await envVaultPresence(
    NAMES,
    {},
    files("PUSHOVER_USER_KEY=  # purpose\n", null),
  );
  assert.equal(result.PUSHOVER_USER_KEY, "empty");
});

void test("values file lines with no content are empty", async () => {
  for (const line of [
    "PUSHOVER_USER_KEY=''",
    'PUSHOVER_USER_KEY=""',
    "PUSHOVER_USER_KEY=",
  ]) {
    assert.equal((await userOnly(`${line}\n`)).PUSHOVER_USER_KEY, "empty");
  }
});

void test("a quoted value in the values file is filled", async () => {
  assert.equal(
    (await userOnly("PUSHOVER_USER_KEY='abc'\n")).PUSHOVER_USER_KEY,
    "filled",
  );
});

void test("a longer sibling name does not fill the name", async () => {
  const result = await userOnly("PUSHOVER_USER_KEY_OLD='x'\n");
  assert.equal(result.PUSHOVER_USER_KEY, "unset");
});

void test("no files and an empty environment give unset", async () => {
  assert.deepEqual(await envVaultPresence(NAMES, {}, files(null, null)), {
    PUSHOVER_USER_KEY: "unset",
    PUSHOVER_APP_TOKEN: "unset",
  });
});

void test("the answer holds states only and no value", async () => {
  const result = await envVaultPresence(
    NAMES,
    { PUSHOVER_USER_KEY: "fake-user-168" },
    files(null, "PUSHOVER_APP_TOKEN='abc'\nPUSHOVER_APP_TOKEN_OLD='x'\n"),
  );
  const text = JSON.stringify(result);
  for (const leak of ["fake-user-168", "abc", "x'"]) {
    assert.equal(text.includes(leak), false);
  }
  for (const state of Object.values(result)) {
    assert.ok(["unset", "empty", "filled"].includes(state));
  }
});
