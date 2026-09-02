import { createHash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import writeFileAtomic from "write-file-atomic";
import {
  DEFAULT_CLAUDE_ACCOUNT_ID,
  type ClaudeAccountSummary,
} from "../../../shared/types.js";
import type { ClaudeIdentity } from "../../adapters/claude-cli.js";
import {
  CLAUDE_ACCOUNTS_DIR,
  CLAUDE_ACCOUNTS_REGISTRY_PATH,
  CLAUDE_HOME_DIR,
  CLAUDE_HOME_JSON_PATH,
} from "../infra/paths.js";
import {
  getOrchestrationConfig,
  updateActiveClaudeAccountId,
} from "../infra/config-holder.js";

export interface ClaudeAccountRecord {
  id: string;
  email: string;
  orgId: string;
  orgName: string;
  subscriptionType: string;
  createdAt: string;
  lastLoginAt: string;
}

export type AccountSummaryWithoutUsage = Omit<ClaudeAccountSummary, "usage">;

export type LaunchAccount = { id: string; configDir?: string };

type LinkAction = "link" | "replace" | "keep";

interface LinkOp {
  name: string;
  action: LinkAction;
}

type ExistingEntry =
  { kind: "symlink"; target: string } | { kind: "file" } | { kind: "dir" };

export const ACCOUNT_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const BLOCKLIST_EXACT = new Set([
  ".claude.json",
  ".claude.json.lock",
  ".credentials.json",
  "backups",
  "statsig",
  "debug",
  "shell-snapshots",
  "todos",
  "session-env",
  "sessions",
  "cache",
  "paste-cache",
  "file-history",
  "downloads",
  "history.jsonl",
]);

const RECORD_STRING_FIELDS = [
  "email",
  "orgId",
  "orgName",
  "subscriptionType",
  "createdAt",
  "lastLoginAt",
] as const;

/**
 * Whether a home `.claude` entry is per-login state or a credential and must never be linked into
 * an account dir.
 * @remarks Everything else (settings, skills, agents, plugins, projects, memory) is shared on
 * purpose so an account changes billing only; the blocklist is the whole fork.
 */
export function isBlocklisted(name: string): boolean {
  return BLOCKLIST_EXACT.has(name) || name.startsWith(".claude.json.backup");
}

/**
 * Validate a registry id before it is ever joined onto a path.
 */
export function isAccountId(raw: unknown): raw is string {
  return typeof raw === "string" && ACCOUNT_ID_RE.test(raw);
}

/**
 * Validate one registry record in full, so a hand-edited file cannot push `undefined` strings
 * onto the wire.
 */
function isAccountRecord(raw: unknown): raw is ClaudeAccountRecord {
  if (typeof raw !== "object" || raw === null) return false;
  const record = raw as Record<string, unknown>;
  return (
    isAccountId(record.id) &&
    RECORD_STRING_FIELDS.every((key) => typeof record[key] === "string")
  );
}

/**
 * The `CLAUDE_CONFIG_DIR` an added account runs under. Throws on a malformed id so a client string
 * can never become a path segment.
 */
export function accountDir(id: string): string {
  if (!isAccountId(id)) {
    throw new Error("invalid claude account id");
  }
  return path.join(CLAUDE_ACCOUNTS_DIR, id);
}

/**
 * The macOS keychain service Claude Code stores an account's OAuth blob under.
 * @remarks Claude Code 2.1+ suffixes the service with the first 8 hex chars of sha256 of the
 * config dir path when `CLAUDE_CONFIG_DIR` is set; the home login uses the bare service name.
 */
export function keychainServiceName(configDir?: string): string {
  const base = "Claude Code-credentials";
  if (!configDir) return base;
  const suffix = createHash("sha256")
    .update(configDir)
    .digest("hex")
    .slice(0, 8);
  return `${base}-${suffix}`;
}

/**
 * Decide, per home entry, whether the account dir needs a new link, a replacement, or nothing.
 * Pure so the truth table is testable without a filesystem.
 * @remarks Home wins: a regular file or directory sitting where a link belongs is replaced, which
 * discards edits made from inside an account session. That is the accepted cost of keeping one
 * source of truth for settings and skills.
 */
export function planLinks(
  homeNames: string[],
  existing: Record<string, ExistingEntry>,
  homeDir: string,
): LinkOp[] {
  const ops: LinkOp[] = [];
  for (const name of homeNames) {
    if (isBlocklisted(name)) continue;
    const target = path.join(homeDir, name);
    const current = existing[name];
    if (!current) {
      ops.push({ name, action: "link" });
    } else if (current.kind === "symlink" && current.target === target) {
      ops.push({ name, action: "keep" });
    } else {
      ops.push({ name, action: "replace" });
    }
  }
  return ops;
}

async function readExisting(
  dir: string,
): Promise<Record<string, ExistingEntry>> {
  const out: Record<string, ExistingEntry> = {};
  let names: string[];
  try {
    names = await fsp.readdir(dir);
  } catch {
    return out;
  }
  for (const name of names) {
    const full = path.join(dir, name);
    const st = await fsp.lstat(full);
    if (st.isSymbolicLink()) {
      out[name] = { kind: "symlink", target: await fsp.readlink(full) };
    } else if (st.isDirectory()) {
      out[name] = { kind: "dir" };
    } else {
      out[name] = { kind: "file" };
    }
  }
  return out;
}

/**
 * Copy the home `.claude.json` into an account dir once, minus the login identity, so the account's
 * first REPL skips onboarding and inherits the trust map and user MCP servers.
 */
async function seedClaudeJson(dir: string): Promise<void> {
  const dest = path.join(dir, ".claude.json");
  if (fs.existsSync(dest)) return;
  let parsed: Record<string, unknown> = {};
  try {
    const raw = await fsp.readFile(CLAUDE_HOME_JSON_PATH, "utf8");
    const p = JSON.parse(raw) as unknown;
    if (typeof p === "object" && p !== null && !Array.isArray(p)) {
      parsed = { ...(p as Record<string, unknown>) };
    }
  } catch {
    parsed = {};
  }
  delete parsed.oauthAccount;
  await writeFileAtomic(dest, JSON.stringify(parsed, null, 2) + "\n", {
    mode: 0o600,
  });
  fs.chmodSync(dest, 0o600);
}

let mutationChain: Promise<unknown> = Promise.resolve();

function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const next = mutationChain.then(fn, fn);
  mutationChain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

/**
 * Create or repair an account's config dir: mode 0700, every non-blocklisted home entry linked in,
 * stale or foreign entries at those names replaced, `.claude.json` seeded once. Idempotent and run
 * before every launch so a link Claude Code turned into a real file heals itself.
 * @remarks Runs behind the registry mutation chain, and so does `resolveLaunchAccount`, so two
 * launches in one tick cannot race each other's links and a launch cannot resurrect a dir that a
 * concurrent remove is deleting.
 * @see docs/ARCHITECTURE.md#claude-accounts
 */
export function materializeConfigDir(id: string): Promise<string> {
  accountDir(id);
  return serialized(() => materializeConfigDirNow(id));
}

async function materializeConfigDirNow(id: string): Promise<string> {
  const dir = accountDir(id);
  await fsp.mkdir(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);

  let homeNames: string[];
  try {
    homeNames = await fsp.readdir(CLAUDE_HOME_DIR);
  } catch {
    homeNames = [];
  }
  const existing = await readExisting(dir);
  for (const op of planLinks(homeNames, existing, CLAUDE_HOME_DIR)) {
    if (op.action === "keep") continue;
    const link = path.join(dir, op.name);
    if (op.action === "replace") {
      await fsp.rm(link, { recursive: true, force: true });
    }
    try {
      await fsp.symlink(path.join(CLAUDE_HOME_DIR, op.name), link);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
  }
  await seedClaudeJson(dir);
  return dir;
}

/**
 * Remove an account's config dir. Best effort and idempotent; the caller decides whether the
 * registry record goes too.
 */
export async function removeConfigDir(id: string): Promise<void> {
  await fsp
    .rm(accountDir(id), { recursive: true, force: true })
    .catch(() => undefined);
}

/**
 * Read the registry fresh on every call. A missing file is an empty registry; a malformed one
 * throws so a corrupt file surfaces as a 500 instead of hiding accounts that still have config
 * dirs and keychain items on disk.
 */
export async function readRegistry(): Promise<ClaudeAccountRecord[]> {
  let raw: string;
  try {
    raw = await fsp.readFile(CLAUDE_ACCOUNTS_REGISTRY_PATH, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw err;
  }
  const parsed: unknown = JSON.parse(raw);
  const accounts = (parsed as { accounts?: unknown } | null)?.accounts;
  if (!Array.isArray(accounts) || !accounts.every(isAccountRecord)) {
    throw new Error("claude accounts registry is malformed");
  }
  return accounts;
}

async function writeRegistry(accounts: ClaudeAccountRecord[]): Promise<void> {
  await fsp.mkdir(CLAUDE_ACCOUNTS_DIR, { recursive: true, mode: 0o700 });
  fs.chmodSync(CLAUDE_ACCOUNTS_DIR, 0o700);
  await writeFileAtomic(
    CLAUDE_ACCOUNTS_REGISTRY_PATH,
    JSON.stringify({ version: 1, accounts }, null, 2) + "\n",
    { mode: 0o600 },
  );
  fs.chmodSync(CLAUDE_ACCOUNTS_REGISTRY_PATH, 0o600);
}

/**
 * Insert or replace a registry record by id, serialized behind the module mutation chain.
 */
export function upsertAccount(record: ClaudeAccountRecord): Promise<void> {
  accountDir(record.id);
  return serialized(async () => {
    const accounts = (await readRegistry()).filter((a) => a.id !== record.id);
    accounts.push(record);
    await writeRegistry(accounts);
  });
}

/**
 * Drop a registry record and its config dir, and reset the active pointer when it named this
 * account. Signing the dir out first is the orchestration layer's job.
 */
export function removeAccount(
  id: string,
): Promise<{ ok: true } | { ok: false; error: "not-found" }> {
  accountDir(id);
  return serialized(async () => {
    const accounts = await readRegistry();
    if (!accounts.some((a) => a.id === id)) {
      return { ok: false, error: "not-found" };
    }
    await removeConfigDir(id);
    await writeRegistry(accounts.filter((a) => a.id !== id));
    if (getActiveAccountId() === id) {
      updateActiveClaudeAccountId(DEFAULT_CLAUDE_ACCOUNT_ID);
    }
    return { ok: true };
  });
}

/**
 * Prove an account pointer can be launched on: `default` always can; an added id must be in the
 * registry and its config dir must exist on disk, which is then re-linked. Throws a value-free
 * error naming the account's email so the saga reports it on the card.
 * @see docs/ARCHITECTURE.md#claude-accounts
 */
export function resolveLaunchAccount(id: string): Promise<LaunchAccount> {
  if (id === DEFAULT_CLAUDE_ACCOUNT_ID) return Promise.resolve({ id });
  if (!ACCOUNT_ID_RE.test(id)) {
    return Promise.reject(
      new Error(`Claude account ${id} is not a valid account id`),
    );
  }
  return serialized(async () => {
    const record = (await readRegistry()).find((a) => a.id === id);
    if (!record) {
      throw new Error(
        `Claude account ${id} is no longer registered; pick another account in the header`,
      );
    }
    const dir = accountDir(id);
    if (!fs.existsSync(dir)) {
      throw new Error(
        `Claude account ${record.email} has no config directory; re-login from Settings, Accounts`,
      );
    }
    await materializeConfigDirNow(id);
    return { id, configDir: dir };
  });
}

/**
 * The id new sessions launch on, `default` when the config carries none.
 */
export function getActiveAccountId(): string {
  return (
    getOrchestrationConfig()?.activeClaudeAccountId ?? DEFAULT_CLAUDE_ACCOUNT_ID
  );
}

/**
 * Switch the active account after proving the id is in the registry.
 */
export function setActiveAccount(
  id: string,
): Promise<{ ok: true } | { ok: false; error: "not-found" }> {
  if (id !== DEFAULT_CLAUDE_ACCOUNT_ID && !isAccountId(id)) {
    return Promise.resolve({ ok: false, error: "not-found" });
  }
  return serialized(async () => {
    if (id !== DEFAULT_CLAUDE_ACCOUNT_ID) {
      const accounts = await readRegistry();
      if (!accounts.some((a) => a.id === id)) {
        return { ok: false, error: "not-found" };
      }
    }
    updateActiveClaudeAccountId(id);
    return { ok: true };
  });
}

/**
 * Every account for the wire, usage aside: the virtual Default built from the home login's
 * identity first, then registry records sorted by email.
 */
export async function listAccounts(
  homeIdentity: ClaudeIdentity,
): Promise<AccountSummaryWithoutUsage[]> {
  const accounts = await readRegistry();
  const base: AccountSummaryWithoutUsage = {
    id: DEFAULT_CLAUDE_ACCOUNT_ID,
    email: homeIdentity.loggedIn ? homeIdentity.email : "Not signed in",
    orgName: homeIdentity.orgName,
    subscriptionType: homeIdentity.subscriptionType,
    isDefault: true,
  };
  const added = [...accounts]
    .sort((a, b) => a.email.localeCompare(b.email))
    .map<AccountSummaryWithoutUsage>((a) => ({
      id: a.id,
      email: a.email,
      orgName: a.orgName,
      subscriptionType: a.subscriptionType,
      isDefault: false,
      lastLoginAt: a.lastLoginAt,
    }));
  return [base, ...added];
}
