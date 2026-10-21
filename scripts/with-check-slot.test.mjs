import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir, totalmem } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { psState } from "./check-slot-holder.mjs";

const script = join(
  dirname(fileURLToPath(import.meta.url)),
  "with-check-slot.mjs",
);
const scratch = [];
const locked = [];

const baseEnv = { ...process.env };
for (const key of [
  "DISPATCH_CHECK_SLOTS",
  "DISPATCH_CHECK_WAIT_SECONDS",
  "DISPATCH_CHECK_STOPPED_SECONDS",
  "DISPATCH_CHECK_SLOT_HELD",
]) {
  delete baseEnv[key];
}

after(() => {
  for (const dir of locked) chmodSync(dir, 0o700);
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

/**
 * Make a scratch directory that the `after` hook removes.
 */
function scratchDir() {
  const dir = mkdtempSync(join(tmpdir(), "with-check-slot-test-"));
  scratch.push(dir);
  return dir;
}

/**
 * Start the gate and return the child process with a promise for its exit.
 */
function startGate(lockDir, extraEnv, command, ...args) {
  const gate = spawn(process.execPath, [script, command, ...args], {
    env: { ...baseEnv, DISPATCH_CHECK_LOCK_DIR: lockDir, ...extraEnv },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  gate.stderr.on("data", (chunk) => (stderr += chunk));
  const done = new Promise((resolve) => {
    gate.on("close", (code) => resolve({ code, stderr }));
  });
  return { gate, done };
}

/**
 * List the slot files left in a lock directory.
 */
function slotsLeft(lockDir) {
  return readdirSync(lockDir).filter((name) => name.startsWith("check-slot-"));
}

/**
 * Create a slot file that names the given pid as owner.
 */
function holdSlot(lockDir, index, pid) {
  const slot = join(lockDir, `check-slot-${index}`);
  writeFileSync(slot, String(pid));
  return slot;
}

/**
 * Tell if a process with this pid exists.
 */
function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
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

test("passes the exit code through and releases the slot", async () => {
  for (const code of [0, 3]) {
    const lockDir = scratchDir();
    const { done } = startGate(
      lockDir,
      {},
      process.execPath,
      "-e",
      `process.exit(${code})`,
    );
    assert.equal((await done).code, code);
    assert.deepEqual(slotsLeft(lockDir), []);
  }
});

test("runs at most DISPATCH_CHECK_SLOTS commands at once", async () => {
  const lockDir = scratchDir();
  const markers = join(scratchDir(), "markers");
  mkdirSync(markers);
  const results = join(scratchDir(), "results");
  const childCode = `
    const fs = require("node:fs");
    const path = require("node:path");
    const [dir, results] = process.argv.slice(1);
    const marker = path.join(dir, String(process.pid));
    fs.writeFileSync(marker, "");
    fs.appendFileSync(results, fs.readdirSync(dir).length + "\\n");
    setTimeout(() => fs.unlinkSync(marker), 800);
  `;
  const runs = Array.from({ length: 5 }, () =>
    startGate(
      lockDir,
      { DISPATCH_CHECK_SLOTS: "3" },
      process.execPath,
      "-e",
      childCode,
      markers,
      results,
    ),
  );
  const outcomes = await Promise.all(runs.map((run) => run.done));
  const counts = readFileSync(results, "utf8").trim().split("\n").map(Number);
  assert.deepEqual(
    outcomes.map((outcome) => outcome.code),
    [0, 0, 0, 0, 0],
  );
  assert.equal(counts.length, 5);
  assert.ok(Math.max(...counts) <= 3, `counts were ${counts}`);
  assert.ok(
    outcomes.some((outcome) =>
      outcome.stderr.includes("waiting for a free slot"),
    ),
  );
  assert.deepEqual(slotsLeft(lockDir), []);
});

test("reclaims slots whose owner is dead", async () => {
  const lockDir = scratchDir();
  const deadPid = spawnSync(process.execPath, ["-e", ""]).pid;
  holdSlot(lockDir, 0, deadPid);
  holdSlot(lockDir, 1, deadPid);
  const started = Date.now();
  const { done } = startGate(
    lockDir,
    { DISPATCH_CHECK_SLOTS: "2" },
    process.execPath,
    "-e",
    "",
  );
  const { code, stderr } = await done;
  assert.equal(code, 0);
  assert.match(
    stderr,
    new RegExp(
      `with-check-slot: released check-slot-0, holder pid ${deadPid} state gone, held \\d+s`,
    ),
  );
  assert.ok(Date.now() - started < 5000);
  const owners = slotsLeft(lockDir).map((name) =>
    readFileSync(join(lockDir, name), "utf8"),
  );
  assert.ok(owners.every((owner) => owner === String(deadPid)));
});

test("keeps a slot held by a live process and gives up with 75", async () => {
  const lockDir = scratchDir();
  const marker = join(scratchDir(), "ran");
  const slot = holdSlot(lockDir, 0, process.pid);
  const { done } = startGate(
    lockDir,
    { DISPATCH_CHECK_SLOTS: "1", DISPATCH_CHECK_WAIT_SECONDS: "1" },
    process.execPath,
    "-e",
    `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "")`,
  );
  const { code, stderr } = await done;
  assert.equal(code, 75);
  assert.match(stderr, /gave up after 1s/);
  assert.equal(existsSync(marker), false);
  assert.equal(readFileSync(slot, "utf8"), String(process.pid));
});

test("releases a slot whose holder is stopped past the threshold", async () => {
  const lockDir = scratchDir();
  const holder = spawn("sleep", ["30"], { stdio: "ignore" });
  try {
    const pid = holder.pid;
    process.kill(pid, "SIGSTOP");
    await waitFor(() => psState(pid)?.startsWith("T"));
    holdSlot(lockDir, 0, pid);
    const started = Date.now();
    const { done } = startGate(
      lockDir,
      {
        DISPATCH_CHECK_SLOTS: "1",
        DISPATCH_CHECK_STOPPED_SECONDS: "1",
        DISPATCH_CHECK_WAIT_SECONDS: "20",
      },
      process.execPath,
      "-e",
      "",
    );
    const { code, stderr } = await done;
    assert.equal(code, 0);
    assert.ok(Date.now() - started >= 1000);
    assert.match(
      stderr,
      new RegExp(
        `with-check-slot: released check-slot-0, holder pid ${pid} state T stopped \\d+s, held \\d+s\\n`,
      ),
    );
    assert.ok(
      stderr.indexOf("with-check-slot: released") <
        stderr.indexOf("with-check-slot: acquired"),
    );
    assert.deepEqual(slotsLeft(lockDir), []);
  } finally {
    holder.kill("SIGKILL");
  }
});

test("keeps a slot whose live holder runs, whatever the threshold", async () => {
  const lockDir = scratchDir();
  const marker = join(scratchDir(), "ran");
  const slot = holdSlot(lockDir, 0, process.pid);
  const { done } = startGate(
    lockDir,
    {
      DISPATCH_CHECK_SLOTS: "1",
      DISPATCH_CHECK_STOPPED_SECONDS: "0",
      DISPATCH_CHECK_WAIT_SECONDS: "2",
    },
    process.execPath,
    "-e",
    `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "")`,
  );
  const { code, stderr } = await done;
  assert.equal(code, 75);
  assert.doesNotMatch(stderr, /released/);
  assert.equal(existsSync(marker), false);
  assert.equal(readFileSync(slot, "utf8"), String(process.pid));
});

test("prints the acquired line only after a wait", async () => {
  const lockDir = scratchDir();
  const slot = holdSlot(lockDir, 0, process.pid);
  const waited = startGate(
    lockDir,
    { DISPATCH_CHECK_SLOTS: "1", DISPATCH_CHECK_WAIT_SECONDS: "10" },
    process.execPath,
    "-e",
    "",
  );
  let seen = "";
  waited.gate.stderr.on("data", (chunk) => (seen += chunk));
  await waitFor(() => seen.includes("waiting for a free slot"));
  rmSync(slot);
  const { code, stderr } = await waited.done;
  assert.equal(code, 0);
  assert.match(stderr, /\nwith-check-slot: acquired\n$/);
  const direct = startGate(
    lockDir,
    { DISPATCH_CHECK_SLOTS: "1" },
    process.execPath,
    "-e",
    "",
  );
  assert.deepEqual(await direct.done, { code: 0, stderr: "" });
});

test("runs at once without a slot when DISPATCH_CHECK_SLOT_HELD is 1", async () => {
  const lockDir = scratchDir();
  const marker = join(scratchDir(), "ran");
  holdSlot(lockDir, 0, process.pid);
  const { done } = startGate(
    lockDir,
    {
      DISPATCH_CHECK_SLOTS: "1",
      DISPATCH_CHECK_WAIT_SECONDS: "1",
      DISPATCH_CHECK_SLOT_HELD: "1",
    },
    process.execPath,
    "-e",
    `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "")`,
  );
  assert.equal((await done).code, 0);
  assert.equal(existsSync(marker), true);
});

test("releases the slot and stops the child on SIGTERM", async () => {
  const lockDir = scratchDir();
  const pidFile = join(scratchDir(), "child-pid");
  const { gate, done } = startGate(
    lockDir,
    { DISPATCH_CHECK_SLOTS: "1" },
    process.execPath,
    "-e",
    `require("node:fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setTimeout(() => {}, 30000)`,
  );
  const childPid = await waitFor(() => {
    const pid = Number(existsSync(pidFile) && readFileSync(pidFile, "utf8"));
    return Number.isInteger(pid) && pid > 0 ? pid : 0;
  });
  gate.kill("SIGTERM");
  await done;
  assert.deepEqual(slotsLeft(lockDir), []);
  await waitFor(() => !isAlive(childPid), 5000);
});

test("exits 127 and leaves no slot when the command is missing", async () => {
  const lockDir = scratchDir();
  const { done } = startGate(lockDir, {}, "dispatch-no-such-command-xyz");
  assert.equal((await done).code, 127);
  assert.deepEqual(slotsLeft(lockDir), []);
});

test("stops a grandchild of the payload when the gate gets SIGTERM", async () => {
  const lockDir = scratchDir();
  const dir = scratchDir();
  const pidFile = join(dir, "sleep.pid");
  const { gate, done } = startGate(
    lockDir,
    { DISPATCH_CHECK_SLOTS: "1" },
    "sh",
    "-c",
    `sleep 30 & echo $! > ${JSON.stringify(pidFile)}; wait`,
  );
  const sleepPid = await waitFor(() => {
    const pid = Number(existsSync(pidFile) && readFileSync(pidFile, "utf8"));
    return Number.isInteger(pid) && pid > 0 ? pid : 0;
  });
  gate.kill("SIGTERM");
  assert.equal((await done).code, 143);
  await waitFor(() => !isAlive(sleepPid), 5000);
  assert.deepEqual(slotsLeft(lockDir), []);
});

test("a fresh .reclaim guard blocks reclaim until it is stale", async () => {
  const lockDir = scratchDir();
  const deadPid = spawnSync(process.execPath, ["-e", ""]).pid;
  const slot = holdSlot(lockDir, 0, deadPid);
  const guard = join(lockDir, ".reclaim");
  mkdirSync(guard);
  const blocked = startGate(
    lockDir,
    { DISPATCH_CHECK_SLOTS: "1", DISPATCH_CHECK_WAIT_SECONDS: "1" },
    process.execPath,
    "-e",
    "",
  );
  assert.equal((await blocked.done).code, 75);
  assert.equal(readFileSync(slot, "utf8"), String(deadPid));
  const old = new Date(Date.now() - 120000);
  utimesSync(guard, old, old);
  const reclaimed = startGate(
    lockDir,
    { DISPATCH_CHECK_SLOTS: "1", DISPATCH_CHECK_WAIT_SECONDS: "5" },
    process.execPath,
    "-e",
    "",
  );
  assert.equal((await reclaimed.done).code, 0);
  assert.deepEqual(slotsLeft(lockDir), []);
  assert.equal(existsSync(guard), false);
});

test("reclaims a slot file with garbage content", async () => {
  const lockDir = scratchDir();
  writeFileSync(join(lockDir, "check-slot-0"), "abc");
  const { done } = startGate(
    lockDir,
    { DISPATCH_CHECK_SLOTS: "1", DISPATCH_CHECK_WAIT_SECONDS: "5" },
    process.execPath,
    "-e",
    "",
  );
  assert.equal((await done).code, 0);
  assert.deepEqual(slotsLeft(lockDir), []);
});

test("reclaims a slot with a live pid that predates the last boot", async () => {
  const lockDir = scratchDir();
  const slot = holdSlot(lockDir, 0, process.pid);
  utimesSync(slot, 0, 0);
  const { done } = startGate(
    lockDir,
    { DISPATCH_CHECK_SLOTS: "1", DISPATCH_CHECK_WAIT_SECONDS: "5" },
    process.execPath,
    "-e",
    "",
  );
  assert.equal((await done).code, 0);
  assert.deepEqual(slotsLeft(lockDir), []);
});

test("DISPATCH_CHECK_WAIT_SECONDS=0 tries once and exits 75", async () => {
  const lockDir = scratchDir();
  const marker = join(scratchDir(), "ran");
  holdSlot(lockDir, 0, process.pid);
  const started = Date.now();
  const { done } = startGate(
    lockDir,
    { DISPATCH_CHECK_SLOTS: "1", DISPATCH_CHECK_WAIT_SECONDS: "0" },
    process.execPath,
    "-e",
    `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "")`,
  );
  assert.equal((await done).code, 75);
  assert.ok(Date.now() - started < 2000);
  assert.equal(existsSync(marker), false);
});

test("exits 2 and names DISPATCH_CHECK_LOCK_DIR when the lock dir is unwritable", async (t) => {
  if (process.getuid?.() === 0) {
    t.skip("root ignores directory permissions");
    return;
  }
  const parent = scratchDir();
  chmodSync(parent, 0o500);
  locked.push(parent);
  const { code, stderr } = await startGate(
    join(parent, "locks"),
    {},
    process.execPath,
    "-e",
    "",
  ).done;
  assert.equal(code, 2);
  assert.match(stderr, /DISPATCH_CHECK_LOCK_DIR/);
});

test("the default slot count is one per 8 GB of memory, at least one", async () => {
  const lockDir = scratchDir();
  const expected = Math.max(1, Math.floor(totalmem() / 2 ** 30 / 8));
  const runs = Array.from({ length: expected + 1 }, () =>
    startGate(lockDir, {}, "sleep", "3"),
  );
  await waitFor(() => slotsLeft(lockDir).length === expected, 2000);
  await sleep(300);
  assert.equal(slotsLeft(lockDir).length, expected);
  const outcomes = await Promise.all(runs.map((run) => run.done));
  assert.deepEqual(
    outcomes.map((outcome) => outcome.code),
    runs.map(() => 0),
  );
  assert.equal(
    outcomes.filter((outcome) =>
      outcome.stderr.includes("waiting for a free slot"),
    ).length,
    1,
  );
});
