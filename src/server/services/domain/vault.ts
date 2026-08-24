import fs from "node:fs";
import fsp from "node:fs/promises";
import writeFileAtomic from "write-file-atomic";
import type { VaultKeySummary } from "../../../shared/types.js";
import {
  VAULT_DIR,
  VAULT_METADATA_PATH,
  VAULT_VALUES_PATH,
  VAULT_SCHEMA_PATH,
} from "../infra/paths.js";

/**
 * Env-var-style key name: uppercase letters, digits and underscores, never starting with a digit.
 * @public Consumed by `vault.route.ts`'s POST validation, wired in plan 02.
 */
export const VAULT_NAME_RE = /^[A-Z_][A-Z0-9_]*$/;

/**
 * Result union for create/set/edit, callers map each `error` to the appropriate HTTP status.
 * Never carries a value, only metadata.
 * @public Consumed by `vault.route.ts`'s status-mapping, wired in plan 02.
 */
export type VaultWriteResult =
  | { ok: true; key: VaultKeySummary }
  | { ok: false; error: "name-exists" | "not-found" };

/**
 * Result union for delete.
 * @public Consumed by `vault.route.ts`'s status-mapping, wired in plan 02.
 */
export type VaultDeleteResult =
  { ok: true } | { ok: false; error: "not-found" };

const SCHEMA_HEADER = `# =============================================================================
# Dispatch vault schema, readable by Claude.
# This file lists key NAMES and what they are for. It never holds values.
# The values live sealed beside it in values.env, which no Claude session can
# ever read.
#
# Format: KEY= followed by a "# purpose" comment. A key with no value yet is
# marked [empty].
# =============================================================================`;

/**
 * Read the vault's metadata file fresh from disk on every call, no cache, so a mutation lands
 * immediately. A missing or malformed store degrades to `[]` rather than throwing, so an absent
 * vault renders an empty list instead of a 500.
 */
async function readMetadata(): Promise<VaultKeySummary[]> {
  let raw: string;
  try {
    raw = await fsp.readFile(VAULT_METADATA_PATH, "utf8");
  } catch {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const keys = (parsed as { keys?: unknown } | null)?.keys;
  return Array.isArray(keys) ? (keys as VaultKeySummary[]) : [];
}

/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * Read the values file as raw, unparsed `NAME=value` lines. Never splits a line on `=`, so no
 * value ever exists as a standalone variable outside the mutator that received it from its caller.
 */
async function readValueLines(): Promise<string[]> {
  let raw: string;
  try {
    raw = await fsp.readFile(VAULT_VALUES_PATH, "utf8");
  } catch {
    return [];
  }
  return raw.split("\n").filter((line) => line.length > 0);
}
/* eslint-enable @typescript-eslint/no-unused-vars */

/**
 * Wrap `value` as a POSIX single-quoted shell literal.
 * @remarks A later milestone phase sources this file with `set -a; . values.env; set +a`, so an
 * unquoted value containing a space, `$`, backtick or quote would be either unsourceable or a
 * command injection into that runner. Single-quoting neutralizes every one of those characters;
 * an embedded single quote is escaped by closing the quote, emitting an escaped quote, then
 * reopening it (`'\''`).
 */
function quoteEnvValue(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function valueLineFor(name: string, value: string): string {
  return `${name}=${quoteEnvValue(value)}`;
}

/** Render the Claude-readable schema surface. A key's value is never a source for this output. */
function serializeSchema(keys: VaultKeySummary[]): string {
  const sorted = [...keys].sort((a, b) => a.name.localeCompare(b.name));
  const lines = sorted.map((key) => {
    const prefix = `${key.name}=`.padEnd(26);
    const suffix = key.filled ? "" : "  [empty]";
    return `${prefix}# ${key.purpose}${suffix}`;
  });
  return [SCHEMA_HEADER, "", ...lines].join("\n") + "\n";
}

/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * The single write chokepoint every mutator routes through. Re-asserts 0700/0600 on every call
 * since both `mkdir`'s and `write-file-atomic`'s `mode` options are create-only, so an externally
 * loosened directory or file would otherwise stay loose. Write order is values, then metadata,
 * then schema, so a crash always leaves the read-mostly schema surface stale, never the values
 * file (T-103-02).
 */
async function writeStore(
  keys: VaultKeySummary[],
  valueLines: string[],
): Promise<void> {
  await fsp.mkdir(VAULT_DIR, { recursive: true, mode: 0o700 });
  fs.chmodSync(VAULT_DIR, 0o700);

  const sorted = [...keys].sort((a, b) => a.name.localeCompare(b.name));

  await writeFileAtomic(VAULT_VALUES_PATH, valueLines.join("\n") + "\n", {
    mode: 0o600,
  });
  fs.chmodSync(VAULT_VALUES_PATH, 0o600);

  await writeFileAtomic(
    VAULT_METADATA_PATH,
    JSON.stringify({ version: 1, keys: sorted }, null, 2) + "\n",
    { mode: 0o600 },
  );
  fs.chmodSync(VAULT_METADATA_PATH, 0o600);

  await writeFileAtomic(VAULT_SCHEMA_PATH, serializeSchema(sorted), {
    mode: 0o600,
  });
  fs.chmodSync(VAULT_SCHEMA_PATH, 0o600);
}
/* eslint-enable @typescript-eslint/no-unused-vars */

/**
 * List every vault key's metadata, sorted by name. Opens only `vault.json`, never `values.env`,
 * so a value cannot reach this path structurally (T-103-01).
 * @public Consumed by `vault.route.ts`'s GET handler, wired in plan 02.
 */
export async function listKeys(): Promise<VaultKeySummary[]> {
  const keys = await readMetadata();
  return [...keys].sort((a, b) => a.name.localeCompare(b.name));
}
