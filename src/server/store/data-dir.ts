import os from "node:os";
import path from "node:path";

/**
 * Resolve the Dispatch data directory once for every layer: `DISPATCH_DIR` from the environment
 * when set, else `~/.dispatch`.
 * @remarks Lives in the bottom layer because the store and adapters may not import
 * `services/infra/paths.ts`; before this every layer re-derived `~/.dispatch` on its own, so an
 * isolated second instance silently opened the live instance's database.
 */
function resolveDispatchDir(): string {
  const override = process.env.DISPATCH_DIR;
  return override && override.trim() !== ""
    ? path.resolve(override)
    : path.join(os.homedir(), ".dispatch");
}

export const DISPATCH_DATA_DIR = resolveDispatchDir();
