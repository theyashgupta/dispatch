import type { EnvPresence } from "../../../shared/types.js";
import { boardRepository as store } from "../../store/board-repository.js";
import {
  PUSHOVER_NAMES,
  missingPushover,
  pushoverStartLine,
  type PushoverName,
} from "../domain/pushover-check.js";
import { envVaultPresence } from "../infra/vault.js";

/**
 * Read the Pushover presence states and tell the store which names are empty.
 *
 * @remarks It makes no network call and never holds a value, only presence states.
 */
export async function checkPushover(
  read: () => Promise<Record<PushoverName, EnvPresence>> = () =>
    envVaultPresence(PUSHOVER_NAMES),
): Promise<PushoverName[]> {
  const missing = missingPushover(await read());
  store.setPushoverMissing(missing);
  return missing;
}

/**
 * Check the Pushover values once, log the start line, then re-check every 60 seconds.
 *
 * @remarks The timer is unref'd so it never holds the process open. Only the start check logs; a
 * later check updates the store and stays silent.
 */
export async function startPushoverWatch(): Promise<void> {
  const line = pushoverStartLine(await checkPushover());
  if (line !== null) console.warn(line);
  setInterval(() => {
    void checkPushover().catch((err: unknown) =>
      console.error(
        `[notify] pushover check failed: ${(err as Error).message}`,
      ),
    );
  }, 60_000).unref();
}
