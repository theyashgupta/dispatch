import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Config } from "../../shared/types.js";
import { StartupError } from "./binaryCheck.js";
import { CONFIG_DIR, CONFIG_PATH } from "../services/paths.js";

const DEFAULT_PORT = 4700;
const DEFAULT_POLL_INTERVAL_MS = 60_000;
const DEFAULT_WORKSPACE_ROOT = path.join(os.homedir(), "dispatch-workspaces");

/**
 * First-run template. Uses "//" keys as inline documentation (valid JSON, ignored on load)
 * so a user can read the guidance and still have the file parse cleanly after editing.
 */
const CONFIG_TEMPLATE = {
  "//": "Dispatch config. Fill in linearApiKey, then restart. This file is kept at mode 0600 (owner read/write only).",
  "// linearApiKey":
    "Required. Linear personal API key: Linear -> Settings -> Security & access -> Personal API keys -> New key.",
  linearApiKey: "",
  "// port": "Backend HTTP port (loopback only). Default 4700.",
  port: DEFAULT_PORT,
  "// pollIntervalMs": "Linear poll interval in ms. Default 60000 (60s).",
  pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
  "// workspaceRoot": "Phase 2+. Root folder for per-ticket workspaces.",
  workspaceRoot: DEFAULT_WORKSPACE_ROOT,
};

/**
 * Load and validate the config, or bootstrap it.
 * - Missing file: create the dir (0o700), write the 0o600 template, print guidance, exit(1).
 * - Existing file: parse, REQUIRE linearApiKey (throw StartupError if empty), apply defaults for
 *   port/pollIntervalMs, tighten perms to 0o600. Retired repoPaths/baseBranches keys are ignored
 *   with a one-line notice when still present on disk.
 * The API key value is never logged (presence is logged as a boolean only).
 */
export function loadConfig(): Config {
  if (!fs.existsSync(CONFIG_PATH)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
    fs.writeFileSync(
      CONFIG_PATH,
      JSON.stringify(CONFIG_TEMPLATE, null, 2) + "\n",
      { mode: 0o600 },
    );
    fs.chmodSync(CONFIG_PATH, 0o600);
    process.stderr.write(
      `No config found. Wrote a template to ${CONFIG_PATH}.\n` +
        `Add your Linear API key (field "linearApiKey") and restart.\n`,
    );
    process.exit(1);
  }

  try {
    const st = fs.statSync(CONFIG_PATH);
    if ((st.mode & 0o077) !== 0) {
      fs.chmodSync(CONFIG_PATH, 0o600);
    }
  } catch {}

  let raw: string;
  try {
    raw = fs.readFileSync(CONFIG_PATH, "utf8");
  } catch (err) {
    throw new StartupError(
      `Could not read config at ${CONFIG_PATH}: ${(err as Error).message}`,
    );
  }

  let parsedUnknown: unknown;
  try {
    parsedUnknown = JSON.parse(raw);
  } catch (err) {
    throw new StartupError(
      `Config at ${CONFIG_PATH} is not valid JSON (${(err as Error).message}). Fix it and restart.`,
    );
  }
  if (
    typeof parsedUnknown !== "object" ||
    parsedUnknown === null ||
    Array.isArray(parsedUnknown)
  ) {
    throw new StartupError(
      `Config at ${CONFIG_PATH} must be a JSON object. Fix it and restart.`,
    );
  }
  const parsed = parsedUnknown as Record<string, unknown>;

  const rawKey =
    typeof parsed.linearApiKey === "string" ? parsed.linearApiKey.trim() : "";
  if (rawKey === "") {
    throw new StartupError(
      `Linear API key missing in ${CONFIG_PATH}. Set the "linearApiKey" field and restart.`,
    );
  }

  if (parsed.repoPaths !== undefined || parsed.baseBranches !== undefined) {
    process.stderr.write(
      "[config] repoPaths is no longer used — add a workspace folder from the start modal.\n",
    );
  }

  const workspaceRoot =
    typeof parsed.workspaceRoot === "string" &&
    parsed.workspaceRoot.trim() !== ""
      ? parsed.workspaceRoot.trim()
      : DEFAULT_WORKSPACE_ROOT;

  const config: Config = {
    linearApiKey: rawKey,
    port: typeof parsed.port === "number" ? parsed.port : DEFAULT_PORT,
    pollIntervalMs:
      typeof parsed.pollIntervalMs === "number"
        ? parsed.pollIntervalMs
        : DEFAULT_POLL_INTERVAL_MS,
    workspaceRoot,
  };

  const hasKey = config.linearApiKey.length > 0;
  console.log(`[config] loaded ${CONFIG_PATH} (api key present: ${hasKey})`);
  return config;
}
