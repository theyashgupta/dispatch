import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Resolve the Dispatch data directory once for every layer: `DISPATCH_DIR` from the environment
 * when set, else `~/.dispatch`, else under the Node test runner a throwaway folder.
 * @remarks Lives in the bottom layer so every layer shares one rule and an isolated second
 * instance never opens the live database. A test process with no override must never open the live folder, so it gets a folder named by
 * its pid that it deletes at exit, before the OS can give the same pid to a later test.
 */
function resolveDispatchDir(): string {
  const override = process.env.DISPATCH_DIR;
  if (override && override.trim() !== "") return path.resolve(override);
  if (process.env.NODE_TEST_CONTEXT) {
    const dir = path.join(os.tmpdir(), `dispatch-unisolated-${process.pid}`);
    process.once("exit", () =>
      fs.rmSync(dir, { recursive: true, force: true }),
    );
    return dir;
  }
  return path.join(os.homedir(), ".dispatch");
}

export const DISPATCH_DATA_DIR = resolveDispatchDir();
