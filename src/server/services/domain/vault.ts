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

    const lines = await readValueLines();
    if (input.value !== undefined) {
      lines.push(valueLineFor(input.name, input.value));
    }

    await writeStore([...keys, key], lines);
    return { ok: true, key };
  });
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
