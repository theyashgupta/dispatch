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

const PIN = (name: string): string =>
  [
    "set-option",
    "-t",
    name,
    "window-size",
    "latest",
    ";",
    "set-hook",
    "-t",
    name,
    "client-detached",
    `if -F -t =${name}: '#{==:#{session_attached},0}' { resize-window -t =${name}: -x 200 -y 50 ; set-option -w -t =${name}: window-size latest }`,
  ].join("\t");

void test("newSession sizes the window to its client on the session it creates", async () => {
  fake.reset();
  await tmux.newSession("dsp-winsize-args", env.root, []);
  assert.ok(calls().includes(PIN("dsp-winsize-args")));
});

void test("pinWindowSizeToClient sends window-size latest and the detach restore hook", async () => {
  fake.reset();
  await tmux.pinWindowSizeToClient("dsp-winsize-pin");
  assert.deepEqual(calls(), [PIN("dsp-winsize-pin")]);
});
