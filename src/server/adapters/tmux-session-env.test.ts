import test from "node:test";
import assert from "node:assert/strict";
import { isolateTmuxEnv } from "../test-support/fixtures.js";

const env = await isolateTmuxEnv();
const tmux = await import("./tmux.js");
const { run } = await import("./exec.js");

const showEnv = async (target: string): Promise<string> =>
  (
    await run("tmux", [
      ...tmux.TMUX_SERVER_ARGS,
      "show-environment",
      "-t",
      target,
    ])
  ).stdout;

void test(
  "setSessionEnv sets and unsets one variable in one session only (private tmux server)",
  { skip: !env.canRunRealTmux },
  async () => {
    const name = `dsp-setenv-${process.pid}`;
    const prefixed = `${name}-sibling`;
    await tmux.newSession(name, env.root, ["sleep", "60"]);
    await tmux.newSession(prefixed, env.root, ["sleep", "60"]);
    try {
      const dir = "/tmp/accounts/it's here";
      await tmux.setSessionEnv(`=${name}`, "CLAUDE_CONFIG_DIR", dir);
      assert.match(
        await showEnv(`=${name}`),
        /^CLAUDE_CONFIG_DIR=\/tmp\/accounts\/it's here$/m,
      );
      assert.equal(
        await tmux.sessionEnvHas(`=${name}`, "CLAUDE_CONFIG_DIR"),
        true,
      );
      assert.equal(
        await tmux.sessionEnvHas(`=${prefixed}`, "CLAUDE_CONFIG_DIR"),
        false,
        "the exact-match target never reaches a prefixed sibling",
      );

      await tmux.setSessionEnv(`=${name}`, "CLAUDE_CONFIG_DIR", undefined);
      assert.equal(
        await tmux.sessionEnvHas(`=${name}`, "CLAUDE_CONFIG_DIR"),
        false,
      );
      assert.doesNotMatch(await showEnv(`=${name}`), /^CLAUDE_CONFIG_DIR=/m);

      await tmux.setSessionEnv(`=${name}`, "CLAUDE_CONFIG_DIR", undefined);
      await assert.rejects(
        tmux.setSessionEnv("=dsp-no-such-session", "CLAUDE_CONFIG_DIR", dir),
      );
    } finally {
      await tmux.killSession(`=${name}`);
      await tmux.killSession(`=${prefixed}`);
      await env.killServer();
    }
  },
);

void test.after(() => env.cleanup());
