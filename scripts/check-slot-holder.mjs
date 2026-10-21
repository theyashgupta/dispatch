import { spawnSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { uptime } from "node:os";

/**
 * Read the owner of a slot file as "free", "stale", "busy" or the owner pid.
 *
 * @remarks
 * A slot is "stale" when its content is not a positive integer, when it is a directory, or when it is older than the last boot, because a pid from before the boot can name an unrelated process. Any other read error returns "busy" so a slot is never removed on a failure that says nothing about its owner.
 */
export function readOwner(path) {
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
export function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

/**
 * Read the `ps` state of a process, or null when the process is gone.
 *
 * @remarks
 * "?" on a failed `ps` start keeps an unknown state from freeing a slot.
 */
export function psState(pid) {
  if (!isAlive(pid)) return null;
  const result = spawnSync("ps", ["-o", "stat=", "-p", String(pid)], {
    encoding: "utf8",
  });
  if (result.error) return "?";
  if (result.status !== 0) return null;
  return result.stdout.trim();
}

/**
 * Check the holder of a slot file and answer free, stale, busy, gone, alive or stopped.
 *
 * @remarks
 * `ps` has no stop time, so the stopped seconds count from the first check that saw the pid stopped, and a pid that runs again resets its clock. The caller owns `stoppedSince` and passes the same map on every poll.
 */
export function checkHolder(
  slotPath,
  { stateOf = psState, now = Date.now(), stoppedSince },
) {
  const owner = readOwner(slotPath);
  if (typeof owner !== "number") return { verdict: owner };
  const state = stateOf(owner);
  if (state === null) {
    stoppedSince.delete(owner);
    return { verdict: "gone", pid: owner };
  }
  if (!state.startsWith("T")) {
    stoppedSince.delete(owner);
    return { verdict: "alive", pid: owner };
  }
  if (!stoppedSince.has(owner)) stoppedSince.set(owner, now);
  return {
    verdict: "stopped",
    pid: owner,
    stoppedSeconds: (now - stoppedSince.get(owner)) / 1000,
  };
}
