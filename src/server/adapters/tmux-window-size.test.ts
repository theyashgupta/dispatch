import test from "node:test";
import assert from "node:assert/strict";
import { isolateEnv } from "../test-support/fixtures.js";

const env = isolateEnv();
process.env.TMUX_TMPDIR = env.root;
delete process.env.TMUX;
const tmux = await import("./tmux.js");
const { run } = await import("./exec.js");
const { resolveBinaryPath } = await import("./resolve-binary.js");
const hasTmux = (await resolveBinaryPath("tmux")) !== null;

const CLIENT_SERVER = ["-L", `dspc-${process.pid}`];
const raw = (args: string[]) =>
  run("tmux", [...tmux.TMUX_SERVER_ARGS, ...args]);
const windowSize = async (name: string) =>
  (
    await raw([
      "display",
      "-p",
      "-t",
      `=${name}:`,
      "#{window_width}x#{window_height}",
    ])
  ).stdout.trim();
const clientCount = async (name: string) =>
  (
    await raw(["list-clients", "-t", `=${name}`]).catch(() => ({ stdout: "" }))
  ).stdout
    .trim()
    .split("\n")
    .filter(Boolean).length;
const until = async (probe: () => Promise<boolean>) => {
  for (let i = 0; i < 50 && !(await probe()); i++) {
    await new Promise((r) => setTimeout(r, 100));
  }
};

void test(
  "a 40x20 client that attaches and detaches leaves the window at 200x50",
  { skip: !hasTmux },
  async () => {
    const name = `dsp-winsize-${process.pid}`;
    await tmux.newSession(name, env.root, ["sh", "-c", "sleep 30"]);
    try {
      const attach = ["env", "-u", "TMUX", "tmux", ...tmux.TMUX_SERVER_ARGS];
      await run("tmux", [
        ...CLIENT_SERVER,
        "new-session",
        "-d",
        "-x",
        "40",
        "-y",
        "20",
        ...attach,
        "attach",
        "-t",
        `=${name}`,
      ]);
      await until(async () => (await clientCount(name)) === 1);
      assert.equal(await clientCount(name), 1);

      await raw(["detach-client", "-s", `=${name}`]);
      await until(async () => (await clientCount(name)) === 0);

      assert.equal(await windowSize(name), "200x50");
    } finally {
      await run("tmux", [...CLIENT_SERVER, "kill-server"]).catch(
        () => undefined,
      );
      await tmux.killSession(`=${name}`);
      await raw(["kill-server"]).catch(() => undefined);
    }
  },
);

void test(
  "widenNarrowWindow restores 200x50 on a window a client already shrank",
  { skip: !hasTmux },
  async () => {
    const name = `dsp-winsize-heal-${process.pid}`;
    await tmux.newSession(name, env.root, ["sh", "-c", "sleep 30"]);
    try {
      await raw(["set-option", "-t", name, "window-size", "latest"]);
      await raw(["resize-window", "-t", `=${name}:`, "-x", "44", "-y", "46"]);
      assert.equal(await windowSize(name), "44x46");

      await tmux.widenNarrowWindow(name);

      assert.equal(await windowSize(name), "200x50");
      assert.equal(
        (
          await raw(["show-options", "-wv", "-t", `=${name}:`, "window-size"])
        ).stdout.trim(),
        "manual",
      );
    } finally {
      await tmux.killSession(`=${name}`);
      await raw(["kill-server"]).catch(() => undefined);
    }
  },
);
