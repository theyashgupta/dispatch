import os from "node:os";
import path from "node:path";

/**
 * Canonical `~/.dispatch` root — the single source of truth for on-disk config/playbook locations,
 * living in the services layer so both bootstrap (config.ts) and services (playbooks.ts) can import
 * it without either re-deriving `os.homedir()` or crossing the services→bootstrap boundary.
 */
export const DISPATCH_DIR = path.join(os.homedir(), ".dispatch");

/**
 * `config.json` location, homed in `services` so both the bootstrap loader and a future services-layer
 * writer can share it without either re-deriving the path or crossing the services→bootstrap boundary.
 * `CONFIG_DIR` is derived from `DISPATCH_DIR` (not aliased) to keep a single source of truth for the
 * `~/.dispatch` root while remaining a distinct export.
 */
export const CONFIG_DIR = path.join(DISPATCH_DIR);
export const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");
