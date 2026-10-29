import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  linkSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { constants, homedir, totalmem } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import {
  checkHolder,
  isAlive,
  readOwner,
  releaseLine,
  shouldRelease,
} from "./check-slot-holder.mjs";

const [command, ...args] = process.argv.slice(2);
const env = process.env;
const slots = positiveInt(
  env.DISPATCH_CHECK_SLOTS,
  Math.max(1, Math.floor(totalmem() / 2 ** 30 / 8)),
);
const waitSeconds = nonNegativeInt(env.DISPATCH_CHECK_WAIT_SECONDS, 5400);
const stoppedLimit = nonNegativeInt(env.DISPATCH_CHECK_STOPPED_SECONDS, 300);
const lockDir =
  env.DISPATCH_CHECK_LOCK_DIR || join(homedir(), ".dispatch", "locks");
const POLL_MS = 500;
const GUARD_STALE_MS = 60_000;
const QUEUE_STALE_MS = 15_000;
const queueDir = join(lockDir, "check-queue");
const entryPath = join(queueDir, `${process.pid}.json`);
const entry = {
  pid: process.pid,
  class: env.DISPATCH_CHECK_CLASS === "ship" ? "ship" : "loop",
  card: env.DISPATCH_CARD_ID || null,
  arrivedAt: new Date().toISOString(),
};
let heldSlot = null;
let registered = false;
let child = null;
const stoppedSince = new Map();

/**
 * Parse a positive integer and fall back to the default for any other value.
 */
function positiveInt(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

/**
 * Parse an integer of 0 or more and fall back to the default for any other value.
 */
function nonNegativeInt(value, fallback) {
  if (String(value ?? "").trim() === "") return fallback;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : fallback;
}

/**
 * Tell if a slot must be freed: a stale slot, or a holder that is gone or stopped past the limit.
 */
function mustFree(check) {
  return check.verdict === "stale" || shouldRelease(check, stoppedLimit);
}

/**
 * Take a slot by hard-linking a private file that already holds the pid onto the slot path.
 *
 * @remarks
 * The link fails with EEXIST when the slot exists and never replaces it, and the file already has its content when it appears. Callers try it only for a free slot or after a reclaim, so a held slot costs no temp file.
 */
function tryTake(slotPath) {
  const tmp = join(lockDir, `.tmp-${process.pid}-${randomUUID()}`);
  writeFileSync(tmp, String(process.pid));
  try {
    linkSync(tmp, slotPath);
    return true;
  } catch (error) {
    if (error.code === "EEXIST") return false;
    throw error;
  } finally {
    unlinkSync(tmp);
  }
}

/**
 * Read the token in a guard owner file, or null when the file cannot be read.
 */
function readToken(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/**
 * Free a slot whose holder must be freed, under a guard directory that admits one reclaimer at a time.
 *
 * @remarks
 * The guard holds a random token, and the slot is removed only while the guard still holds this caller's token, so a reclaimer whose stale guard was replaced removes nothing. The holder is checked again under the guard and the slot is removed only when the same pid still must be freed, so a slot that was freed and retaken, or a holder that runs again, is kept.
 */
function reclaim(slotPath, pid) {
  const guard = join(lockDir, ".reclaim");
  const tokenFile = join(guard, "owner");
  const token = randomUUID();
  try {
    mkdirSync(guard, { mode: 0o700 });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const stat = statSync(guard, { throwIfNoEntry: false });
    if (stat && Date.now() - stat.mtimeMs > GUARD_STALE_MS) {
      rmSync(guard, { recursive: true, force: true });
    }
    return;
  }
  try {
    writeFileSync(tokenFile, token);
    const check = checkHolder(slotPath, { stoppedSince });
    if (
      mustFree(check) &&
      check.pid === pid &&
      readToken(tokenFile) === token
    ) {
      const line = check.pid ? releaseLine(slotPath, check) : null;
      rmSync(slotPath, { recursive: true, force: true });
      if (line) console.error(line);
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  } finally {
    if (readToken(tokenFile) === token) {
      rmSync(guard, { recursive: true, force: true });
    }
  }
}

/**
 * Take a free slot after the first `ahead` open slots and return its path, or null.
 *
 * @remarks
 * The open slots before it are left to the waiters ahead in the queue. Every poll checks each holder, so a stopped holder is released on the first poll after the limit.
 */
function tryAcquire(ahead) {
  let open = 0;
  for (let i = 0; i < slots; i += 1) {
    const slotPath = join(lockDir, `check-slot-${i}`);
    const check = checkHolder(slotPath, { stoppedSince });
    const free = check.verdict === "free";
    if (!free && !mustFree(check)) continue;
    open += 1;
    if (open <= ahead) continue;
    if (!free) reclaim(slotPath, check.pid);
    if (tryTake(slotPath)) return slotPath;
  }
  return null;
}

/**
 * List the pids that hold a slot.
 */
function holders() {
  const pids = [];
  for (let i = 0; i < slots; i += 1) {
    const owner = readOwner(join(lockDir, `check-slot-${i}`));
    if (typeof owner === "number") pids.push(owner);
  }
  return pids;
}

/**
 * Remove the queue entry and the held slot of this process, then write the status.
 *
 * @remarks
 * The entry goes first, so no waiter counts a finished holder as a waiter ahead of it. The slot is removed only when its pid file still names this process.
 */
function release() {
  dropFile(entryPath);
  if (heldSlot && readOwner(heldSlot) === process.pid) {
    rmSync(heldSlot, { force: true });
  }
  heldSlot = null;
  if (registered) writeStatus();
}

/**
 * Remove a queue file, and ignore an error so a broken queue never fails the gate or changes its exit.
 */
function dropFile(path) {
  try {
    rmSync(path, { force: true });
  } catch {
    return;
  }
}

/**
 * Write a file through a temp file and a rename, so a reader never sees half of it.
 */
function writeAtomic(path, text) {
  const tmp = join(lockDir, `.tmp-${process.pid}-${randomUUID()}`);
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}

/**
 * Order queue entries ship class first, then by arrival time, then by pid.
 */
function byTakeOrder(a, b) {
  return (
    (a.class === "ship" ? 0 : 1) - (b.class === "ship" ? 0 : 1) ||
    Date.parse(a.arrivedAt) - Date.parse(b.arrivedAt) ||
    a.pid - b.pid
  );
}

/**
 * Read the queue entries, remove the ones of dead or stale waiters, and return the waiters that hold no slot in take order.
 *
 * @remarks
 * A waiter writes its entry on every poll, so an entry older than 15 s that holds no slot belongs to a stopped waiter, a zombie or a reused pid. A stopped waiter that polls again writes its entry back with its first arrival time and gets its place back. The entry of each pid in `owners` is kept and stored in the map for the status.
 */
function readQueue(owners, now = Date.now()) {
  const queue = [];
  let pruned = false;
  for (const name of readdirSync(queueDir)) {
    const path = join(queueDir, name);
    let item;
    let mtimeMs;
    try {
      mtimeMs = statSync(path).mtimeMs;
      item = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      continue;
    }
    if (owners.has(item?.pid)) {
      owners.set(item.pid, item);
    } else if (
      Number.isInteger(item?.pid) &&
      item.pid > 0 &&
      isAlive(item.pid) &&
      now - mtimeMs <= QUEUE_STALE_MS
    ) {
      queue.push(item);
    } else {
      dropFile(path);
      pruned = true;
    }
  }
  return { queue: queue.sort(byTakeOrder), pruned };
}

/**
 * Write the slot holders and the queue to `check-queue.json`.
 *
 * @remarks
 * It is a snapshot, so a pid in it can be gone. A second pass writes again when the state changed during the first, which narrows the race where an older snapshot replaces a newer one. A failed write never fails the gate.
 */
function writeStatus() {
  try {
    let last = null;
    for (let pass = 0; pass < 2; pass += 1) {
      const slotted = [];
      for (let i = 0; i < slots; i += 1) {
        const pid = readOwner(join(lockDir, `check-slot-${i}`));
        if (typeof pid === "number")
          slotted.push({ slot: `check-slot-${i}`, pid });
      }
      const owners = new Map(slotted.map(({ pid }) => [pid, null]));
      const { queue } = readQueue(owners);
      const state = {
        holders: slotted.map(({ slot, pid }) => ({
          slot,
          pid,
          class: owners.get(pid)?.class ?? null,
          card: owners.get(pid)?.card ?? null,
        })),
        queue,
      };
      const key = JSON.stringify(state);
      if (key === last) return;
      last = key;
      writeAtomic(
        join(lockDir, "check-queue.json"),
        `${JSON.stringify({ updatedAt: new Date().toISOString(), ...state }, null, 2)}\n`,
      );
    }
  } catch {
    return;
  }
}

/**
 * Register this waiter and count the live waiters ahead of it that hold no slot.
 *
 * @remarks
 * It writes the status on the first poll and after it removes an entry. A queue error gives 0, so a broken queue costs the order but never fails the gate.
 */
function waitersAhead() {
  try {
    mkdirSync(queueDir, { recursive: true, mode: 0o700 });
    writeAtomic(entryPath, JSON.stringify(entry));
    const { queue, pruned } = readQueue(
      new Map(holders().map((pid) => [pid, null])),
    );
    if (!registered || pruned) {
      registered = true;
      writeStatus();
    }
    const index = queue.findIndex((item) => item.pid === process.pid);
    return index === -1 ? queue.length : index;
  } catch {
    return 0;
  }
}

/**
 * Send a signal to the child's whole process group.
 *
 * @remarks
 * The child leads its own group, so grandchildren of an npm or sh payload receive the signal too. An error means the group is already gone.
 */
function forward(signal) {
  try {
    process.kill(-child.pid, signal);
  } catch {
    return;
  }
}

/**
 * Run the command with inherited stdio and resolve with the exit code the gate must use.
 */
function run(childEnv) {
  return new Promise((resolve) => {
    child = spawn(command, args, {
      stdio: "inherit",
      env: childEnv,
      detached: true,
    });
    child.on("error", (error) => {
      console.error(`with-check-slot: ${error.message}`);
      resolve(127);
    });
    child.on("exit", (code, signal) =>
      resolve(code ?? 128 + constants.signals[signal]),
    );
  });
}

if (!command) {
  console.error("usage: with-check-slot <command> [args...]");
  process.exit(2);
}

process.on("exit", release);
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    if (child) forward(signal);
    else process.exit(128 + constants.signals[signal]);
  });
}

if (env.DISPATCH_CHECK_SLOT_HELD === "1") process.exit(await run(env));

const deadline = Date.now() + waitSeconds * 1000;
let announced = false;
try {
  mkdirSync(lockDir, { recursive: true, mode: 0o700 });
  while (!(heldSlot = tryAcquire(waitersAhead()))) {
    if (!announced) {
      announced = true;
      console.error(
        `with-check-slot: waiting for a free slot, holders: ${holders().join(",")} (${lockDir})`,
      );
    }
    if (Date.now() >= deadline) {
      console.error(
        `with-check-slot: gave up after ${waitSeconds}s waiting for a free slot`,
      );
      process.exit(75);
    }
    await sleep(POLL_MS);
  }
} catch (error) {
  console.error(
    `with-check-slot: cannot use lock directory ${lockDir}: ${error.message} (set DISPATCH_CHECK_LOCK_DIR)`,
  );
  process.exit(2);
}
writeStatus();
if (announced) console.error("with-check-slot: acquired");
process.exit(await run({ ...env, DISPATCH_CHECK_SLOT_HELD: "1" }));
