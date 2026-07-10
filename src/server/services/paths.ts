import os from "node:os";
import path from "node:path";

/**
 * Canonical `~/.dispatch` root — the single source of truth for on-disk config/playbook locations,
 * living in the services layer so both bootstrap (config.ts) and services (playbooks.ts) can import
 * it without either re-deriving `os.homedir()` or crossing the services→bootstrap boundary.
 */
export const DISPATCH_DIR = path.join(os.homedir(), ".dispatch");
