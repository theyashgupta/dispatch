import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { isolateEnv } from "../test-support/fixtures.js";
import { installFakeTmux } from "../test-support/fake-tmux.js";

const env = isolateEnv();
const fake = installFakeTmux(env);
const tmux = await import("./tmux.js");

const calls = (): string[] =>
  fs
    .readFileSync(path.join(fake.state, "calls.log"), "utf8")
    .trim()
    .split("\n");

void test("newSession pins window-size manual on the session it creates", async () => {
  fake.reset();
  await tmux.newSession("dsp-winsize-args", env.root, []);
  assert.ok(
    calls().includes(
      ["set-option", "-t", "dsp-winsize-args", "window-size", "manual"].join(
        "\t",
      ),
    ),
  );
});

void test("pinWindowSizeManual sends the session-scoped window-size option", async () => {
  fake.reset();
  await tmux.pinWindowSizeManual("dsp-winsize-pin");
  assert.deepEqual(calls(), [
    ["set-option", "-t", "dsp-winsize-pin", "window-size", "manual"].join("\t"),
  ]);
});
