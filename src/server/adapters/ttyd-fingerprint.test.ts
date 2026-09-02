import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { run } from "./exec.js";
import test from "node:test";
import {
  TTYD_INSTANCE_RETAINED_KEY,
  TTYD_RUNTIME_REVISION_RETAINED_KEY,
  classifyDspTtydProcesses,
} from "./ttyd-fingerprint.js";

const OLD_REVISION_KEY = "DISPATCH_TTYD_REVISION_5";
const FOREIGN_INSTANCE_KEY = "DISPATCH_TTYD_INSTANCE_0123456789ab";

/** A `ps -axww -o pid=,command=` line as ttyd rewrites it: `-t k=v` shows as `-t k v`. */
function ttydLine(pid: number, ...retainedKeys: string[]): string {
  const tokens = retainedKeys.map((k) => `-t ${k} 1`).join(" ");
  return `${pid} /opt/homebrew/bin/ttyd -W -i 127.0.0.1 -p 0 -b /sessions/abc/terminal -t disableLeaveAlert true ${tokens} tmux -u attach -t =dsp-x`;
}

const PS = [
  ttydLine(101, TTYD_RUNTIME_REVISION_RETAINED_KEY, TTYD_INSTANCE_RETAINED_KEY),
  ttydLine(102, TTYD_RUNTIME_REVISION_RETAINED_KEY, FOREIGN_INSTANCE_KEY),
  ttydLine(103, TTYD_RUNTIME_REVISION_RETAINED_KEY),
  ttydLine(104, OLD_REVISION_KEY, TTYD_INSTANCE_RETAINED_KEY),
  ttydLine(105, OLD_REVISION_KEY, FOREIGN_INSTANCE_KEY),
  "106 /opt/homebrew/bin/ttyd -W -p 7681 bash",
  "107 /usr/bin/ssh -t host tmux attach",
  `108 node dist/server/bootstrap/index.js ttyd ${TTYD_RUNTIME_REVISION_RETAINED_KEY}`,
  ttydLine(109, TTYD_RUNTIME_REVISION_RETAINED_KEY, TTYD_INSTANCE_RETAINED_KEY),
].join("\n");

const { candidates, compatible } = classifyDspTtydProcesses(PS, new Set([109]));

void test("own instance key + current revision is adoptable and sweepable", () => {
  assert.ok(candidates.has(101));
  assert.ok(compatible.has(101));
});

void test("foreign instance key is neither swept nor adopted", () => {
  assert.ok(!candidates.has(102));
  assert.ok(!compatible.has(102));
  assert.ok(!candidates.has(105));
});

void test("legacy no-instance-key ttyd is swept, never adopted", () => {
  assert.ok(candidates.has(103));
  assert.ok(!compatible.has(103));
});

void test("old revision with own instance key is swept, never adopted", () => {
  assert.ok(candidates.has(104));
  assert.ok(!compatible.has(104));
});

void test("non-Dispatch ttyd, non-ttyd binaries, and own pids are ignored", () => {
  assert.deepEqual([...candidates].sort(), [101, 103, 104]);
  assert.ok(!candidates.has(106));
  assert.ok(!candidates.has(107));
  assert.ok(!candidates.has(108));
  assert.ok(!candidates.has(109));
});

void test("an unrewritten KEY=1 token still yields the bare instance id", () => {
  const raw = `201 ttyd -b /sessions/abc/terminal -t ${TTYD_RUNTIME_REVISION_RETAINED_KEY}=1 -t ${TTYD_INSTANCE_RETAINED_KEY}=1 tmux attach`;
  const r = classifyDspTtydProcesses(raw, new Set());
  assert.ok(r.compatible.has(201));
});

void test("the instance key follows DISPATCH_DIR, so two instances under one HOME never share it", async () => {
  const script =
    'import("./src/server/adapters/ttyd-fingerprint.ts").then((m) => console.log(m.TTYD_INSTANCE_RETAINED_KEY))';
  const keyFor = async (dir: string) =>
    (
      await run(process.execPath, ["--import", "tsx", "-e", script], {
        cwd: process.cwd(),
        env: { ...(process.env as Record<string, string>), DISPATCH_DIR: dir },
      })
    ).stdout.trim();
  const home = await keyFor("");
  const override = await keyFor(path.join(os.tmpdir(), "dispatch-fp-test"));
  assert.match(home, /^DISPATCH_TTYD_INSTANCE_[0-9a-f]{12}$/);
  assert.match(override, /^DISPATCH_TTYD_INSTANCE_[0-9a-f]{12}$/);
  assert.notEqual(home, override);
});
