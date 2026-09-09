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

const raw = (args: string[]) =>
  run("tmux", [...tmux.TMUX_SERVER_ARGS, ...args]);
const paneBorderStatus = async (name: string) =>
  (
    await raw(["show-options", "-wv", "-t", `=${name}:`, "pane-border-status"])
  ).stdout.trim();
const geometry = async (name: string) =>
  (
    await raw([
      "display-message",
      "-p",
      "-t",
      `=${name}:`,
      "#{pane_top} #{pane_height} #{window_height}",
    ])
  ).stdout.trim();
const until = async (probe: () => Promise<boolean>) => {
  for (let i = 0; i < 50 && !(await probe()); i++) {
    await new Promise((r) => setTimeout(r, 100));
  }
};

void test(
  "the pane returns to row 0 after a Claude teammate split leaves pane-border-status top behind",
  { skip: !hasTmux },
  async () => {
    const name = `dsp-bordertest-${process.pid}`;
    await tmux.newSession(name, env.root, ["sh", "-c", "sleep 30"]);
    try {
      await raw([
        "split-window",
        "-d",
        "-t",
        `=${name}:`,
        "-h",
        "sh",
        "-c",
        "sleep 30",
      ]);
      await raw([
        "set-option",
        "-w",
        "-t",
        `=${name}:`,
        "pane-border-status",
        "top",
      ]);
      assert.equal(await paneBorderStatus(name), "top");

      const teammate = (
        await raw(["list-panes", "-t", `=${name}:`, "-F", "#{pane_id}"])
      ).stdout
        .trim()
        .split("\n")
        .at(-1)!;
      await raw(["kill-pane", "-t", teammate]);
      await until(async () => (await paneBorderStatus(name)) === "off");

      assert.equal(await paneBorderStatus(name), "off");
      const [top, paneHeight, windowHeight] = (await geometry(name)).split(" ");
      assert.equal(top, "0");
      assert.equal(paneHeight, windowHeight);
    } finally {
      await tmux.killSession(`=${name}`);
      await raw(["kill-server"]).catch(() => undefined);
    }
  },
);

void test(
  "reattach heals a single-pane window already stuck with pane-border-status top",
  { skip: !hasTmux },
  async () => {
    const name = `dsp-borderheal-${process.pid}`;
    await tmux.newSession(name, env.root, ["sh", "-c", "sleep 30"]);
    try {
      await raw([
        "set-option",
        "-w",
        "-t",
        `=${name}:`,
        "pane-border-status",
        "top",
      ]);
      assert.equal((await geometry(name)).split(" ")[0], "1");
      await tmux.pinPaneBorderOff(name);
      assert.equal(await paneBorderStatus(name), "off");
      assert.equal((await geometry(name)).split(" ")[0], "0");
    } finally {
      await tmux.killSession(`=${name}`);
      await raw(["kill-server"]).catch(() => undefined);
    }
  },
);
