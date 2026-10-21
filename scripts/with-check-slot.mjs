import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  linkSync,
  mkdirSync,
  readFileSync,
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
let heldSlot = null;
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
 * Take the first free slot and return its path, or null when all slots are held.
 *
 * @remarks
 * Every poll checks each holder, so a stopped holder is released on the first poll after the limit.
 */
function tryAcquire() {
  for (let i = 0; i < slots; i += 1) {
    const slotPath = join(lockDir, `check-slot-${i}`);
    const check = checkHolder(slotPath, { stoppedSince });
    if (check.verdict === "free") {
      if (tryTake(slotPath)) return slotPath;
    } else if (mustFree(check)) {
      reclaim(slotPath, check.pid);
      if (tryTake(slotPath)) return slotPath;
    }
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
 * Remove the held slot only when its pid file still names this process.
 */
function release() {
  if (heldSlot && readOwner(heldSlot) === process.pid) {
    rmSync(heldSlot, { force: true });
  }
  heldSlot = null;
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
  while (!(heldSlot = tryAcquire())) {
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
if (announced) console.error("with-check-slot: acquired");
process.exit(await run({ ...env, DISPATCH_CHECK_SLOT_HELD: "1" }));
