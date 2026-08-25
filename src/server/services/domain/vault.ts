import fs from "node:fs";
import fsp from "node:fs/promises";
import writeFileAtomic from "write-file-atomic";
import type { VaultKeySummary } from "../../../shared/types.js";
import {
  VAULT_DIR,
  VAULT_METADATA_PATH,
  VAULT_VALUES_PATH,
  VAULT_SCHEMA_PATH,
  ENV_VAULT_SCHEMA_PATH,
  ENV_VAULT_VALUES_PATH,
} from "../infra/paths.js";

/**
 * Env-var-style key name: uppercase letters, digits and underscores, never starting with a digit.
 */
export const VAULT_NAME_RE = /^[A-Z_][A-Z0-9_]*$/;

/**
 * Result union for create/set/edit, callers map each `error` to the appropriate HTTP status.
 * Never carries a value, only metadata.
 */
export type VaultWriteResult =
  | { ok: true; key: VaultKeySummary }
  | { ok: false; error: "name-exists" | "not-found" };

/**
 * Result union for delete.
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
 * immediately. Only a missing file (fresh install) degrades to `[]`; a malformed file throws.
 * @remarks Degrading a corrupt `vault.json` to `[]` would leave the intact `values.env` lines
 * invisible in every management surface but still exported by the runner, and the next mutation
 * would rewrite the metadata carrying those orphaned secrets forward permanently. Failing closed
 * surfaces the corruption as a 500 instead.
 */
async function readMetadata(): Promise<VaultKeySummary[]> {
  let raw: string;
  try {
    raw = await fsp.readFile(VAULT_METADATA_PATH, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw err;
  }
  const parsed: unknown = JSON.parse(raw);
  const keys = (parsed as { keys?: unknown } | null)?.keys;
  if (
    !Array.isArray(keys) ||
    keys.some(
      (k: unknown) =>
        typeof (k as { name?: unknown } | null)?.name !== "string",
    )
  ) {
    throw new Error("vault metadata is malformed");
  }
  return keys as VaultKeySummary[];
}

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

/**
 * Assert the name invariant the file format depends on, independent of route validation.
 * @remarks A name containing `=`, whitespace or a newline breaks the one-line `NAME=value`
 * format and the `NAME=` prefix filters, so any future non-route caller must hit this wall too.
 */
function assertVaultName(name: string): void {
  if (!VAULT_NAME_RE.test(name)) {
    throw new Error("invalid vault key name");
  }
}

function valueLineFor(name: string, value: string): string {
  assertVaultName(name);
  if (/[\r\n]/.test(value)) {
    throw new Error("vault value must be single-line");
  }
  return `${name}=${quoteEnvValue(value)}`;
}

let mutationChain: Promise<unknown> = Promise.resolve();

/**
 * Serialize a vault mutation behind a module-level promise chain.
 * @remarks Every mutator is a read-modify-write across three files; two interleaved calls can
 * clobber an acknowledged write or land the files from different snapshots. A promise chain is
 * sufficient because this single process is the only vault writer.
 */
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const next = mutationChain.then(fn, fn);
  mutationChain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
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

/**
 * The single write chokepoint every mutator routes through. Re-asserts 0700/0600 on every call
 * since both `mkdir`'s and `write-file-atomic`'s `mode` options are create-only, so an externally
 * loosened directory or file would otherwise stay loose (T-103-02). Write order is values, then
 * metadata, then schema, so a crash always leaves the read-mostly schema surface stale, never the
 * values file.
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

/**
 * List every vault key's metadata, sorted by name. Opens only `vault.json`, never `values.env`,
 * so a value cannot reach this path structurally (T-103-01).
 */
export async function listKeys(): Promise<VaultKeySummary[]> {
  const keys = await readMetadata();
  return [...keys].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Create a new vault key. Name collisions are checked by exact match, the name regex is already
 * upper-case-only so a case-folded compare would be dead code. The directory is (re-)created here
 * since a user could delete it between boot and this call.
 */
export async function createKey(input: {
  name: string;
  purpose: string;
  value?: string;
}): Promise<VaultWriteResult> {
  assertVaultName(input.name);
  return serialized(async () => {
    const now = new Date().toISOString();
    const keys = await readMetadata();
    if (keys.some((k) => k.name === input.name)) {
      return { ok: false, error: "name-exists" };
    }

    const key: VaultKeySummary = {
      name: input.name,
      purpose: input.purpose,
      createdAt: now,
      updatedAt: now,
      filled: input.value !== undefined,
    };

    const lines = (await readValueLines()).filter(
      (line) => !line.startsWith(`${input.name}=`),
    );
    if (input.value !== undefined) {
      lines.push(valueLineFor(input.name, input.value));
    }

    await writeStore([...keys, key], lines);
    return { ok: true, key };
  });
}

/**
 * Env-vault schema line shape: `NAME=` followed by a `# purpose` comment, matching
 * `~/.claude/env-vault/schema.keys`'s own format.
 */
const SCHEMA_LINE_RE = /^([A-Z_][A-Z0-9_]*)=\s*#\s*(.*)$/;

/** Parse the env-vault schema file's `NAME=  # purpose` lines, skipping blank and `#`-header lines. */
function parseEnvVaultSchema(raw: string): { name: string; purpose: string }[] {
  const out: { name: string; purpose: string }[] = [];
  for (const line of raw.split("\n")) {
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    const m = SCHEMA_LINE_RE.exec(line);
    if (m) out.push({ name: m[1], purpose: m[2].trim() });
  }
  return out;
}

/**
 * Parse the env-vault values file's `NAME='value'` lines into a name-to-value map.
 * @remarks The exact inverse of `quoteEnvValue`: strips one leading/trailing single quote, then
 * reverses the `'\''` embedded-quote escape.
 */
function parseEnvVaultValues(raw: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of raw.split("\n")) {
    if (line.length === 0) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const name = line.slice(0, eq);
    let quoted = line.slice(eq + 1);
    if (quoted.startsWith("'") && quoted.endsWith("'")) {
      quoted = quoted.slice(1, -1);
    }
    out.set(name, quoted.replace(/'\\''/g, "'"));
  }
  return out;
}

/**
 * Result of a one-time env-vault import. Names only, matching `VaultWriteResult`'s write-only
 * contract; a value must never cross into this shape.
 */
export interface ImportResult {
  imported: string[];
  skipped: string[];
}

/**
 * Copy every key from the standalone `~/.claude/env-vault` into Dispatch's own vault store, once.
 * Reuses `createKey` per name so every VLT-01/02 invariant (naming, serialization, mode-assertion)
 * applies unchanged; a name already present in Dispatch's store is skipped, never overwritten
 * (Dispatch's value wins). A source key with no matching values.env line imports with
 * `value: undefined` (filled=false), never defaulted to an empty string. Source files are only
 * ever read here, never written. A per-line or per-key failure is logged server-side and skipped,
 * never thrown, so one malformed source line cannot abort the whole import.
 */
export async function importFromEnvVault(): Promise<ImportResult> {
  const imported: string[] = [];
  const skipped: string[] = [];

  let schemaRaw: string;
  try {
    schemaRaw = await fsp.readFile(ENV_VAULT_SCHEMA_PATH, "utf8");
  } catch {
    return { imported, skipped };
  }

  let valuesRaw: string;
  try {
    valuesRaw = await fsp.readFile(ENV_VAULT_VALUES_PATH, "utf8");
  } catch {
    valuesRaw = "";
  }

  const entries = parseEnvVaultSchema(schemaRaw);
  const values = parseEnvVaultValues(valuesRaw);
  const existing = new Set((await listKeys()).map((k) => k.name));

  for (const { name, purpose } of entries) {
    if (existing.has(name)) {
      skipped.push(name);
      continue;
    }
    try {
      const result = await createKey({ name, purpose, value: values.get(name) });
      if (result.ok) {
        imported.push(name);
      } else {
        skipped.push(name);
      }
    } catch (err) {
      console.error(`env-vault import failed for key ${name}`, err);
    }
  }

  return { imported, skipped };
}

/**
 * Ensure a fresh install has a working, empty vault store before the first key is ever created.
 *
 * @remarks Guards on `VAULT_METADATA_PATH`, not `VAULT_DIR` or a degraded `readMetadata()` call,
 * because the directory is recreated on every mutation (not a reliable "already populated"
 * signal) and a metadata-file read degrades a missing file to `[]` indistinguishably from a
 * genuinely empty store, so only a direct existence check can tell "never written" from "written
 * empty" apart. The guard runs before any write, so a store a prior boot already populated is
 * never wiped.
 */
export async function ensureVaultScaffold(): Promise<void> {
  if (fs.existsSync(VAULT_METADATA_PATH)) return;
  await writeStore([], []);
}

/**
 * Set (or rotate) a key's value. Setting a value on an already-filled key IS the rotate, purpose
 * and createdAt stay untouched, only updatedAt and filled move, this is what makes set and rotate
 * the same endpoint.
 */
export async function setValue(
  name: string,
  value: string,
): Promise<VaultWriteResult> {
  return serialized(async () => {
    const now = new Date().toISOString();
    const keys = await readMetadata();
    const index = keys.findIndex((k) => k.name === name);
    if (index === -1) {
      return { ok: false, error: "not-found" };
    }

    const key: VaultKeySummary = {
      ...keys[index],
      filled: true,
      updatedAt: now,
    };
    const nextKeys = [...keys];
    nextKeys[index] = key;

    const lines = (await readValueLines()).filter(
      (line) => !line.startsWith(`${name}=`),
    );
    lines.push(valueLineFor(name, value));

    await writeStore(nextKeys, lines);
    return { ok: true, key };
  });
}

/**
 * Edit a key's purpose. Never touches the value lines, an edit of the purpose must never rewrite
 * a value.
 */
export async function editPurpose(
  name: string,
  purpose: string,
): Promise<VaultWriteResult> {
  return serialized(async () => {
    const now = new Date().toISOString();
    const keys = await readMetadata();
    const index = keys.findIndex((k) => k.name === name);
    if (index === -1) {
      return { ok: false, error: "not-found" };
    }

    const key: VaultKeySummary = {
      ...keys[index],
      purpose,
      updatedAt: now,
    };
    const nextKeys = [...keys];
    nextKeys[index] = key;

    await writeStore(nextKeys, await readValueLines());
    return { ok: true, key };
  });
}

/**
 * Delete a key and its value line. Matches the value line by a `NAME=` prefix, so a longer
 * sibling name such as `FOOBAR` is untouched by deleting `FOO`.
 */
export async function deleteKey(name: string): Promise<VaultDeleteResult> {
  return serialized(async () => {
    const keys = await readMetadata();
    if (!keys.some((k) => k.name === name)) {
      return { ok: false, error: "not-found" };
    }

    const nextKeys = keys.filter((k) => k.name !== name);
    const lines = (await readValueLines()).filter(
      (line) => !line.startsWith(`${name}=`),
    );

    await writeStore(nextKeys, lines);
    return { ok: true };
  });
}
