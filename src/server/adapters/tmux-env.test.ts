import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { isolateEnv } from "../test-support/fixtures.js";

const env = isolateEnv();
process.env.TMUX_TMPDIR = env.root;
delete process.env.TMUX;
const tmux = await import("./tmux.js");
const { run } = await import("./exec.js");
const { resolveBinaryPath } = await import("./resolve-binary.js");
const hasTmux = (await resolveBinaryPath("tmux")) !== null;

void test(
  "newSession passes CLAUDE_CONFIG_DIR into the pane environment (private tmux server)",
  { skip: !hasTmux },
  async () => {
    const name = `dsp-envtest-${process.pid}`;
    const out = path.join(env.root, "pane-env.txt");
    const configDir = path.join(env.root, "some-account");
    await tmux.newSession(
      name,
      env.root,
      ["sh", "-c", 'printenv CLAUDE_CONFIG_DIR > "$0"; sleep 5', out],
      { CLAUDE_CONFIG_DIR: configDir },
    );
    try {
      for (let i = 0; i < 50 && !fs.existsSync(out); i++) {
        await new Promise((r) => setTimeout(r, 100));
      }
      assert.equal(fs.readFileSync(out, "utf8").trim(), configDir);
      assert.equal(await tmux.hasSession(name), true);
    } finally {
      await tmux.killSession(`=${name}`);
      await run("tmux", ["kill-server"]).catch(() => undefined);
    }
  },
);

void test.after(() => env.cleanup());
