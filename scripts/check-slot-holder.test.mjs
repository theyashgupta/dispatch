import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { after, test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import {
  checkHolder,
  psState,
  releaseLine,
  shouldRelease,
} from "./check-slot-holder.mjs";

const dir = mkdtempSync(join(tmpdir(), "check-slot-holder-test-"));
let slotCount = 0;

after(() => {
  rmSync(dir, { recursive: true, force: true });
});

/**
 * Write a slot file with the given content into the scratch directory and return its path.
 */
function slotWith(content) {
  const slot = join(dir, `check-slot-${slotCount++}`);
  writeFileSync(slot, String(content));
  return slot;
}

/**
 * Build a stateOf function that reads a fake process table.
 */
function tableOf(table) {
  return (pid) => table[pid] ?? null;
}

/**
 * Poll until the check returns a truthy value or the timeout passes.
 */
async function waitFor(check, timeoutMs = 10000) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const value = check();
    if (value) return value;
    assert.ok(Date.now() < end, "timed out waiting for a condition");
    await sleep(50);
  }
}

test("a live pid is alive", () => {
  const slot = slotWith(4242);
  assert.deepEqual(
    checkHolder(slot, {
      stateOf: tableOf({ 4242: "S+" }),
      stoppedSince: new Map(),
    }),
    { verdict: "alive", pid: 4242 },
  );
});

test("a pid missing from the process table is gone", () => {
  const slot = slotWith(4242);
  assert.deepEqual(
    checkHolder(slot, { stateOf: tableOf({}), stoppedSince: new Map() }),
    { verdict: "gone", pid: 4242 },
  );
});

test("stopped seconds count from the first check that saw the stop", () => {
  const slot = slotWith(4242);
  const stateOf = tableOf({ 4242: "T" });
  const stoppedSince = new Map();
  assert.deepEqual(checkHolder(slot, { stateOf, now: 1000, stoppedSince }), {
    verdict: "stopped",
    pid: 4242,
    stoppedSeconds: 0,
  });
  assert.deepEqual(checkHolder(slot, { stateOf, now: 301000, stoppedSince }), {
    verdict: "stopped",
    pid: 4242,
    stoppedSeconds: 300,
  });
});

test("a pid that runs again resets the stopped clock", () => {
  const slot = slotWith(4242);
  const table = { 4242: "T" };
  const stateOf = tableOf(table);
  const stoppedSince = new Map();
  checkHolder(slot, { stateOf, now: 1000, stoppedSince });
  table[4242] = "S";
  assert.equal(
    checkHolder(slot, { stateOf, now: 200000, stoppedSince }).verdict,
    "alive",
  );
  table[4242] = "T";
  assert.deepEqual(checkHolder(slot, { stateOf, now: 400000, stoppedSince }), {
    verdict: "stopped",
    pid: 4242,
    stoppedSeconds: 0,
  });
});

test("an unknown state and a trace stop count as alive", () => {
  const slot = slotWith(4242);
  for (const state of ["?", "t"]) {
    assert.deepEqual(
      checkHolder(slot, {
        stateOf: tableOf({ 4242: state }),
        stoppedSince: new Map(),
      }),
      { verdict: "alive", pid: 4242 },
    );
  }
});

test("a zombie holder is gone", () => {
  const slot = slotWith(4242);
  const check = checkHolder(slot, {
    stateOf: tableOf({ 4242: "Z" }),
    now: 0,
    stoppedSince: new Map(),
  });
  assert.deepEqual(check, { verdict: "gone", pid: 4242 });
  assert.equal(shouldRelease(check, 300), true);
});

test("a free slot between polls resets the stopped clock", () => {
  const slot = slotWith(4242);
  const stateOf = tableOf({ 4242: "T" });
  const stoppedSince = new Map();
  checkHolder(slot, { stateOf, now: 0, stoppedSince });
  writeFileSync(slot, "abc");
  assert.equal(
    checkHolder(slot, { stateOf, now: 1000, stoppedSince }).verdict,
    "stale",
  );
  writeFileSync(slot, "4242");
  assert.deepEqual(checkHolder(slot, { stateOf, now: 400000, stoppedSince }), {
    verdict: "stopped",
    pid: 4242,
    stoppedSeconds: 0,
  });
});

test("a new holder pid in the same slot restarts the stopped clock", () => {
  const slot = slotWith(4242);
  const stoppedSince = new Map();
  checkHolder(slot, { stateOf: tableOf({ 4242: "T" }), now: 0, stoppedSince });
  writeFileSync(slot, "4343");
  assert.deepEqual(
    checkHolder(slot, {
      stateOf: tableOf({ 4343: "T" }),
      now: 400000,
      stoppedSince,
    }),
    { verdict: "stopped", pid: 4343, stoppedSeconds: 0 },
  );
});

test("a missing slot file is free and garbage content is stale", () => {
  const stoppedSince = new Map();
  assert.deepEqual(
    checkHolder(join(dir, "check-slot-missing"), { stoppedSince }),
    { verdict: "free" },
  );
  assert.deepEqual(checkHolder(slotWith("abc"), { stoppedSince }), {
    verdict: "stale",
  });
});

test("psState sees a real process stop and exit", async () => {
  const child = spawn("sleep", ["30"], { stdio: "ignore" });
  const exited = new Promise((resolve) => child.on("exit", resolve));
  try {
    const running = psState(child.pid);
    assert.equal(typeof running, "string");
    assert.ok(!running.startsWith("T"), `state was ${running}`);
    process.kill(child.pid, "SIGSTOP");
    await waitFor(() => psState(child.pid)?.startsWith("T"));
  } finally {
    child.kill("SIGKILL");
  }
  await exited;
  assert.equal(psState(child.pid), null);
});

test("a stopped holder is released only after the threshold", () => {
  const slot = slotWith(4242);
  const stateOf = tableOf({ 4242: "T" });
  const stoppedSince = new Map();
  const released = [0, 300000, 300500].map((now) =>
    shouldRelease(checkHolder(slot, { stateOf, now, stoppedSince }), 300),
  );
  assert.deepEqual(released, [false, false, true]);
});

test("a live holder is never released", () => {
  const slot = slotWith(4242);
  const stateOf = tableOf({ 4242: "S" });
  const stoppedSince = new Map();
  for (const now of [0, 3600000]) {
    assert.equal(
      shouldRelease(checkHolder(slot, { stateOf, now, stoppedSince }), 300),
      false,
    );
  }
});

test("a gone holder is released at once", () => {
  const slot = slotWith(4242);
  const check = checkHolder(slot, {
    stateOf: tableOf({}),
    now: 0,
    stoppedSince: new Map(),
  });
  assert.equal(shouldRelease(check, 300), true);
});

test("free, stale and busy verdicts are never released", () => {
  for (const verdict of ["free", "stale", "busy"]) {
    assert.equal(shouldRelease({ verdict }, 0), false);
  }
});

test("the release line names the holder pid, state and ages", () => {
  const slot = slotWith(4242);
  utimesSync(slot, 1000, 1000);
  const name = basename(slot);
  assert.equal(
    releaseLine(
      slot,
      { verdict: "stopped", pid: 4242, stoppedSeconds: 300.4 },
      1600000,
    ),
    `with-check-slot: released ${name}, holder pid 4242 state T stopped 300s, held 600s`,
  );
  assert.equal(
    releaseLine(slot, { verdict: "gone", pid: 4242 }, 1600000),
    `with-check-slot: released ${name}, holder pid 4242 state gone, held 600s`,
  );
});
