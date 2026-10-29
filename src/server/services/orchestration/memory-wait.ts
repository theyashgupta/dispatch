import type { BoardKey } from "../../../shared/types.js";
import { sleep } from "../../adapters/exec.js";
import type { PolicyCheck } from "../domain/orchestrator-policy.js";
import { releaseFinished } from "./floor-release.js";
import { memoryCheck } from "./memory-governor.js";

const RETRY_MS = 30_000;
const LIMIT_MS = 30 * 60_000;
const RELEASE_WAIT_MS = 30_000;
const RELEASE_POLL_MS = 5_000;

export const memoryWaitTools: {
  check: (boardKey: BoardKey) => PolicyCheck;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  release: (boardKey: BoardKey) => Promise<number>;
} = {
  check: memoryCheck,
  sleep,
  now: () => Date.now(),
  release: releaseFinished,
};

/**
 * Check the board memory, and when it is low, release the finished sessions and wait up to 30 seconds for it.
 *
 * @remarks With no session released there is no wait, so a refusal keeps its old timing.
 */
export async function releaseForMemory(
  boardKey: BoardKey,
  first: PolicyCheck = memoryWaitTools.check(boardKey),
): Promise<PolicyCheck> {
  const { check, sleep, now, release } = memoryWaitTools;
  let result = first;
  if (result.ok || (await release(boardKey)) === 0) return result;
  const deadline = now() + RELEASE_WAIT_MS;
  while (now() < deadline) {
    await sleep(RELEASE_POLL_MS);
    result = check(boardKey);
    if (result.ok) return result;
  }
  return result;
}

/**
 * Wait until the board memory check passes, retrying every 30 seconds for up to 30 minutes.
 *
 * @remarks `onWait` runs once before the first retry so the caller can show the queued state. The
 * finished sessions of the board are released first, through `releaseForMemory`. The helper never
 * throws, so each caller maps the refusal to its own error.
 */
export async function waitForMemory(
  boardKey: BoardKey,
  onWait?: (reason: string) => Promise<void> | void,
): Promise<PolicyCheck> {
  const { check, sleep, now } = memoryWaitTools;
  const deadline = now() + LIMIT_MS;
  let result = check(boardKey);
  if (result.ok) return result;
  await onWait?.(result.reason);
  result = await releaseForMemory(boardKey, result);
  if (result.ok) return result;
  let last = result.reason;
  while (now() < deadline) {
    await sleep(RETRY_MS);
    result = check(boardKey);
    if (result.ok) return result;
    last = result.reason;
  }
  return { ok: false, reason: `${last} after 30 minutes of retries` };
}
