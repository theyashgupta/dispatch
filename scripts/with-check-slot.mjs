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
import { constants, homedir, totalmem, uptime } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const [command, ...args] = process.argv.slice(2);
const env = process.env;
const slots = positiveInt(
  env.DISPATCH_CHECK_SLOTS,
  Math.max(1, Math.floor(totalmem() / 2 ** 30 / 8)),
);
const waitSeconds = nonNegativeInt(env.DISPATCH_CHECK_WAIT_SECONDS, 5400);
const lockDir =
  env.DISPATCH_CHECK_LOCK_DIR || join(homedir(), ".dispatch", "locks");
const POLL_MS = 500;
const GUARD_STALE_MS = 60_000;
let heldSlot = null;
let child = null;

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
 * Read the owner of a slot file as "free", "stale", "busy" or the owner pid.
 *
 * @remarks
 * A slot is "stale" when its content is not a positive integer, when it is a directory, or when it is older than the last boot, because a pid from before the boot can name an unrelated process. Any other read error returns "busy" so a slot is never removed on a failure that says nothing about its owner.
 */
function readOwner(path) {
  try {
    const stat = statSync(path);
    if (stat.isDirectory() || stat.mtimeMs < Date.now() - uptime() * 1000) {
      return "stale";
    }
    const pid = Number(readFileSync(path, "utf8").trim());
    return Number.isInteger(pid) && pid > 0 ? pid : "stale";
  } catch (error) {
    if (error.code === "ENOENT") return "free";
    return error.code === "EISDIR" ? "stale" : "busy";
  }
}

/**
 * Tell if a process with this pid exists.
 *
 * @remarks
 * EPERM means the process exists but belongs to another user, so it counts as alive.
 */
function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

/**
 * Tell if a slot owner is gone: a stale slot, or a pid that no process has.
 */
function isDead(owner) {
  return owner === "stale" || (typeof owner === "number" && !isAlive(owner));
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
 * Free a slot whose owner is gone, under a guard directory that admits one reclaimer at a time.
 *
 * @remarks
 * The guard holds a random token, and the slot is removed only while the guard still holds this caller's token, so a reclaimer whose stale guard was replaced removes nothing. The owner is read again under the guard, so a slot that another process freed and retook is kept.
 */
function reclaim(slotPath) {
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
    const owner = readOwner(slotPath);
    if (isDead(owner) && readToken(tokenFile) === token) {
      rmSync(slotPath, { recursive: true, force: true });
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
 */
function tryAcquire() {
  for (let i = 0; i < slots; i += 1) {
    const slotPath = join(lockDir, `check-slot-${i}`);
    const owner = readOwner(slotPath);
    if (owner === "free") {
      if (tryTake(slotPath)) return slotPath;
    } else if (isDead(owner)) {
      reclaim(slotPath);
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
