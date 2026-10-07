import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { isolateEnv } from "../../test-support/fixtures.js";
import { IDLE_PANE, installFakeTmux } from "../../test-support/fake-tmux.js";

const env = isolateEnv();
const fake = installFakeTmux(env);
const { awaitReplReady } = await import("./steps.js");

const DIALOG = (first: string, second: string): string =>
  ` Accessing workspace:\n\n Quick safety check: Is this a project you created or one you trust?\n\n ${first}\n   ${second}\n\n Enter to confirm · Esc to cancel\n`;

/**
 * Show a trust dialog on a fake pane, wait for readiness, and return the keys sent to it.
 */
async function keysFor(session: string, pane: string): Promise<string[]> {
  fake.reset({ [`pane.${session}`]: pane, [`next.${session}.1`]: IDLE_PANE });
  await awaitReplReady(session);
  return fs
    .readFileSync(path.join(fake.state, "calls.log"), "utf8")
    .split("\n")
    .filter((line) => line.startsWith("send-keys"))
    .map((line) => line.split("\t").at(-1) ?? "");
}

void test("a trust dialog that focuses No, exit gets Down before Enter", async () => {
  assert.deepEqual(
    await keysFor("trust-no", DIALOG("❯ No, exit", "Yes, I trust this folder")),
    ["Down", "Enter"],
  );
});

void test("a trust dialog that focuses Yes gets Enter only", async () => {
  assert.deepEqual(
    await keysFor(
      "trust-yes",
      DIALOG("❯ 1. Yes, I trust this folder", "2. No, exit"),
    ),
    ["Enter"],
  );
});

void test.after(() => env.cleanup());
