import type { EnvPresence } from "../../../shared/types.js";
import { boardRepository as store } from "../../store/board-repository.js";
import {
  PUSHOVER_NAMES,
  missingPushover,
  type PushoverName,
} from "../domain/pushover-check.js";
import { envVaultPresence } from "../infra/vault.js";

/**
 * Read the Pushover presence states and tell the store which names are empty.
 *
 * @remarks It makes no network call and never holds a value, only presence states.
 */
export async function checkPushover(
  read: () => Promise<Record<string, EnvPresence>> = () =>
    envVaultPresence(PUSHOVER_NAMES),
): Promise<PushoverName[]> {
  const missing = missingPushover(
    (await read()) as Record<PushoverName, EnvPresence>,
  );
  store.setPushoverMissing(missing);
  return missing;
}

/**
 * Re-check the Pushover values on a timer and return a function that stops it.
 */
export function startPushoverWatch(intervalMs = 60_000): () => void {
  const timer = setInterval(() => {
    void checkPushover().catch((err: unknown) =>
      console.error(
        `[notify] pushover check failed: ${(err as Error).message}`,
      ),
    );
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
