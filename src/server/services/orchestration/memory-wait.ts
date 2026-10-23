import type { BoardKey } from "../../../shared/types.js";
import { sleep } from "../../adapters/exec.js";
import type { PolicyCheck } from "../domain/orchestrator-policy.js";
import { memoryCheck } from "./memory-governor.js";

const RETRY_MS = 30_000;
const LIMIT_MS = 30 * 60_000;

export const memoryWaitTools: {
  check: (boardKey: BoardKey) => PolicyCheck;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
} = { check: memoryCheck, sleep, now: () => Date.now() };

/**
 * Wait until the board memory check passes, retrying every 30 seconds for up to 30 minutes.
 *
 * @remarks `onWait` runs once before the first retry so the caller can show the queued state. The
 * helper never throws, so each caller maps the refusal to its own error.
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
  let last = result.reason;
  while (now() < deadline) {
    await sleep(RETRY_MS);
    result = check(boardKey);
    if (result.ok) return result;
    last = result.reason;
  }
  return { ok: false, reason: `${last} after 30 minutes of retries` };
}
