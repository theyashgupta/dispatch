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
 * The config file lives directly under `DISPATCH_DIR`; callers that need the containing directory
 * (e.g. first-run mkdir) use `DISPATCH_DIR` itself rather than a duplicate alias export.
 */
export const CONFIG_PATH = path.join(DISPATCH_DIR, "config.json");
