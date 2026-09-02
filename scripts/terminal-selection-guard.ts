/**
 * Regression guard for LOCAL-3 (dev tooling, NOT test code, same category as replay-watcher.ts):
 * text selection in the web terminal must stay native, so Dispatch panes may never hand the mouse
 * to tmux or to Claude Code. Runs `newSession` for real against a PRIVATE tmux server (its own
 * `TMUX_TMPDIR`), so the live server and its sessions are never touched, then checks the two
 * facts the web terminal depends on:
 *
 *   1. The pane environment carries `CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN=1` and
 *      `CLAUDE_CODE_DISABLE_MOUSE=1`, so Claude Code never requests mouse tracking (which tmux
 *      would forward to the browser client even with tmux `mouse off`).
 *   2. The session keeps `mouse off` after a global `set -g mouse on`, the state that turns a drag
 *      into tmux copy-mode (yellow selection, text stuck in a tmux buffer).
 *
 * Usage: `npm run selection-guard` (exit 0 iff both hold). Needs tmux on PATH.
 */
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { killSession, newSession } from "../src/server/adapters/tmux.js";

const REQUIRED_ENV = [
  "CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN=1",
  "CLAUDE_CODE_DISABLE_MOUSE=1",
];

const socketDir = mkdtempSync(join(tmpdir(), "dsp-selection-guard-"));
process.env.TMUX_TMPDIR = socketDir;
delete process.env.TMUX;

const exec = promisify(execFile);
const tmux = async (...args: string[]): Promise<string> =>
  (await exec("tmux", args)).stdout.trim();

const name = `dsp-selection-guard-${process.pid}`;
const failures: string[] = [];
try {
  await newSession(name, tmpdir(), ["sh", "-c", "sleep 30"]);
  const env = (await tmux("show-environment", "-t", name)).split("\n");
  for (const entry of REQUIRED_ENV) {
    if (!env.includes(entry)) failures.push(`pane environment lacks ${entry}`);
  }
  await tmux("set", "-g", "mouse", "on");
  const mouse = await tmux("show", "-Av", "-t", name, "mouse");
  if (mouse !== "off") {
    failures.push(
      `session mouse is "${mouse}" after a global \`set -g mouse on\``,
    );
  }
} catch (err) {
  failures.push(`guard could not run: ${(err as Error).message}`);
} finally {
  await killSession(name);
  await tmux("kill-server").catch(() => {});
  rmSync(socketDir, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error("selection-guard FAIL");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(
  "selection-guard PASS: pane env pins mouse off and session ignores global mouse on",
);
