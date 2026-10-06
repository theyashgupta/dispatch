import fs from "node:fs";
import path from "node:path";
import { DISPATCH_DATA_DIR } from "./data-dir.js";
import { DatabaseSync } from "node:sqlite";
import {
  DEFAULT_BOARD_KEY,
  defaultBoardPolicy,
} from "../../shared/board-key.js";
import type {
  AccountActivityEvent,
  ActivityEvent,
  Board,
  BoardKey,
  BoardSnapshot,
  Card,
  Column,
  EventType,
  ArchivedGroup,
  Item,
  SourceCursor,
} from "../../shared/types.js";

export const BOARD_DB_PATH = path.join(DISPATCH_DATA_DIR, "board.db");

export const STORE_SCHEMA_VERSION = 3;

/** Hardcoded snapshot-backup slot count (`.bak.1` .. `.bak.5`); no config surface (BAK-01). */
export const BACKUP_SLOTS = 5;

const HOUR_MS = 3_600_000;

const MAX_PUSH_SUBSCRIPTIONS = 20;

/**
 * Swallow ONLY node:sqlite's `ExperimentalWarning` — never any other warning — so normal
 * boot/CLI output stays clean while genuine deprecations still surface.
 * @remarks node:sqlite emits the warning once, deferred (nextTick), when this module's
 * `import { DatabaseSync }` first evaluates; installing this filter synchronously in the
 * module body catches that deferred emission. Never use `--no-warnings` (it hides all
 * warnings for an interactive tool). The store import is lazy, so DB-free paths
 * (`dispatch --help`, keyless setup) never load this module and never emit the warning.
 * @see https://github.com/nodejs/node/issues/58611
 */
function installSqliteWarningFilter(): void {
  const original = process.emit.bind(process);
  const patched = (name: string, ...args: unknown[]): boolean => {
    const warning = args[0] as { name?: string; message?: string } | undefined;
    if (
      name === "warning" &&
      warning?.name === "ExperimentalWarning" &&
      typeof warning.message === "string" &&
      warning.message.includes("SQLite")
    ) {
      return false;
    }
    return (original as (...a: unknown[]) => boolean)(name, ...args);
  };
  process.emit = patched;
}

installSqliteWarningFilter();

/**
 * The non-card board fields the store persists alongside the cards — the exact
 * subset `persistSnapshot()` writes today (`syncWarning`/`pollIntervalMs`/`editors`
 * stay in-memory-only, as they did in board.json). Serialized as one JSON blob into
 * the single `meta` row so the schema never churns as these fields evolve.
 */
export interface BoardMeta {
  syncedAt: string | null;
  workspaceFolders: string[];
  lastUsed: string | null;
  /**
   * Minted-at-accept counter for `LOCAL-<n>` ticket identifiers (Phase 61), incremented inside
   * the store's single-writer enqueue queue so concurrent local-card creates can never collide.
   * Optional — defaults to 0 at hydrate time, matching the `syncedAt`/`workspaceFolders`/`lastUsed`
   * precedent; no migration machinery needed for a legacy meta row that predates this field.
   */
  localTicketCounter?: number;
  /**
   * Minted-at-create counter for `GROUP-<n>` identifiers (Phase 63), incremented inside
   * `createGroupCard`'s enqueue mutator. SEPARATE from `localTicketCounter` (Claude's Discretion,
   * 63-CONTEXT.md) — a shared counter would only interleave the two id spaces cosmetically.
   * Optional — defaults to 0 at hydrate time, matching `localTicketCounter`'s precedent.
   */
  groupTicketCounter?: number;
  identifierCounters?: Record<string, number>;
  /**
   * Version counter for the store's boot-time schema migrations, written once by the
   * session-entity migration pass (Phase 90). Optional — defaults to `0` on a legacy row that
   * predates it, matching the `localTicketCounter`/`groupTicketCounter` precedent. This is the
   * idempotency gate a later boot reads back to no-op: once persisted at the current migration's
   * target version, the migration pass never runs again against the same database.
   */
  schemaVersion?: number;
  sourceCursors?: Record<string, SourceCursor>;
}

export interface ItemWrites {
  upserts: Item[];
}

/**
 * The store-facing surface of the SQLite persistence layer — the only place
 * node:sqlite is touched. `persist` writes the FULL card set (including each
 * `hookToken`) so secrets reach the DB; redaction stays the caller's snapshot()
 * concern (STORE-05). `cardCount` drives the one-time import decision in load().
 * @see docs/ARCHITECTURE.md#single-writer-store
 */
export interface BoardDb {
  cardCount(): number;
  readAll(): { cards: Card[]; meta: Partial<BoardMeta> };
  readAllItems(): Item[];
  readBoards(): Board[];
  persist(
    cards: Card[],
    meta: BoardMeta,
    events: Omit<ActivityEvent | AccountActivityEvent, "id">[],
    itemWrites?: ItemWrites,
    boards?: Board[],
  ): number[];
  importParsed(parsed: Partial<BoardSnapshot>): void;
  listEvents(
    board: BoardKey,
    cardId: string | null,
    limit: number,
  ): ActivityEvent[];
  /** Write or replace one archived group row (LOCAL-17); the row id is the group card id. */
  upsertArchive(row: ArchivedGroup): void;
  /** Drop one archived group row; false when no row had that id. */
  deleteArchive(id: string): boolean;
  /** One archived group by id, or undefined. */
  getArchive(id: string): ArchivedGroup | undefined;
  /** Every archived group, newest first. */
  listArchive(): ArchivedGroup[];
  /**
   * Fold a WAL-consistent snapshot into the rotating `.bak.N` chain, throttled to once per hour
   * unless `force` is set. Never throws — a failure is logged once and the primary write proceeds
   * unaffected.
   * @remarks `force` exists so a one-time migration can fold a genuine pre-migration snapshot into
   * the rotating chain without waiting out the hourly throttle; it skips ONLY the elapsed check —
   * the `VACUUM INTO` and slot rotation stay identical, and the never-throw contract is unchanged.
   */
  backupTick(force?: boolean): Promise<void>;
  /**
   * Take the one-off, never-rotated pre-migration copy of `board.db` at `${BOARD_DB_PATH}.pre-v3`.
   * Best-effort and NEVER throws, mirroring `backupTick`'s contract, so a snapshot failure can never
   * fail boot.
   * @remarks Guarded by an `existsSync` check on the TARGET so a second boot can never overwrite a
   * legitimate pre-migration snapshot with an already-migrated database. The rotating five-slot
   * `.bak.N` chain is not sufficient on its own for this purpose: five boots can age a
   * pre-migration snapshot out of the chain, while this file is deliberately never rotated away.
   * @remarks Written with `VACUUM INTO`, the same WAL-aware mechanism `backupTick` uses — NOT a
   * raw `copyFileSync` of the main database file. In WAL mode the main file is only part of the
   * database; committed transactions can still be sitting in `board.db-wal`, which a file copy
   * omits. The boot-time `wal_checkpoint(TRUNCATE)` is not a sufficient guarantee on its own: it
   * runs before `busy_timeout` is set, so with the default timeout of zero any concurrent reader
   * makes it return `busy=1`, and its result row is discarded by `db.exec`. This is the one
   * artifact the migration's whole reversibility story rests on, so it must not be able to become
   * a silently partial database. `VACUUM INTO` also refuses to write an existing target, which
   * preserves the `existsSync` guard's intent a second time over.
   */
  snapshotPreV3(): void;
  /**
   * Upsert a subscription row, keyed by `endpoint`. A re-subscribe from the same device refreshes
   * `p256dh`/`auth`/`origin` AND `created_at` in place rather than accumulating a duplicate row,
   * so `created_at` means "last subscribed at" and eviction targets the least-recently-subscribed
   * device, not the first device ever registered.
   * @returns Whether the row was stored. For a NEW endpoint an at-or-over-cap table evicts
   * exactly as many oldest `created_at` rows as the insert needs (an existing endpoint never
   * evicts), so a permanently-failing endpoint (never pruned by the 404/410 rule) cannot wedge
   * the {@link MAX_PUSH_SUBSCRIPTIONS} cap forever; `false` survives only as a defensive signal.
   * @remarks Safe outside the `persist` write queue: `push_subscriptions` shares no rows with the
   * card/meta/event write path, and the evict + upsert pair runs back-to-back on the process's
   * single synchronous `DatabaseSync` handle (`busy_timeout = 5000`), so no other statement can
   * interleave between them.
   */
  addPushSubscription(sub: PushSubscriptionRow): boolean;
  /**
   * Delete a subscription row by endpoint.
   * @returns Whether a row was actually deleted, so the caller can answer honestly instead of
   * always claiming success.
   * @remarks Safe outside the `persist` write queue for the same reasons as
   * {@link BoardDb.addPushSubscription}.
   */
  removePushSubscription(endpoint: string): boolean;
  /**
   * All subscription rows, for the send-time fan-out.
   * @remarks Safe outside the `persist` write queue for the same reasons as
   * {@link BoardDb.addPushSubscription}.
   */
  listPushSubscriptions(): PushSubscriptionRow[];
}

/**
 * Raw `events` row shape (snake_case columns) before the read-path snake→camel map.
 * @remarks `listEvents` reads rows via a `... as unknown as EventRow[]` double cast because
 * node:sqlite's `.all()` returns a structurally-incompatible index-signature type that TypeScript
 * will not narrow to `EventRow` with a single `as`; the double cast is intentional, not a shortcut.
 */
interface EventRow {
  id: number;
  card_id: string | null;
  type: string;
  from_col: string | null;
  to_col: string | null;
  reason: string | null;
  source: string | null;
  ts: string;
  board_key: string;
}

interface BoardRow {
  key: string;
  name: string;
  workspace_root: string | null;
  repositories: string;
  linear_team_keys: string;
  last_used_folder: string | null;
  policy: string;
  created_at: string;
  archived: number;
}

/** A `push_subscriptions` row, keyed by endpoint (PUSH-09). */
export interface PushSubscriptionRow {
  endpoint: string;
  p256dh: string;
  auth: string;
  origin: string;
  createdAt: string;
}

/** Slot path for the Nth snapshot backup in the `.bak.N` chain. */
function bak(n: number): string {
  return `${BOARD_DB_PATH}.bak.${n}`;
}

/**
 * True only for genuine on-disk SQLite corruption — never for an engine/load, permission,
 * disk-full, or busy failure. node:sqlite puts the numeric SQLite result code on `errcode`;
 * the string `code` is `"ERR_SQLITE_ERROR"` for ALL sqlite errors, so it cannot discriminate.
 * @remarks 11 = SQLITE_CORRUPT, 26 = SQLITE_NOTADB; `& 0xff` folds extended codes (e.g.
 * SQLITE_CORRUPT_VTAB) to their primary. The `constants` export does not expose these.
 * @see https://sqlite.org/rescode.html
 */
function isCorruption(err: unknown): boolean {
  const code = (err as { errcode?: number } | null)?.errcode;
  if (typeof code !== "number") return false;
  const primary = code & 0xff;
  return primary === 11 || primary === 26;
}

/**
 * Run fn in one IMMEDIATE transaction; commit on success, roll back and rethrow on failure —
 * the automatic-rollback guarantee the previous native engine's transaction wrapper gave. A re-entrant call
 * runs inline (a nested `BEGIN` would throw), matching the store's single-writer serialization.
 * @remarks BEGIN IMMEDIATE takes the write lock up front so a failed lock upgrade can't strand
 * a half-applied write; the unconditional ROLLBACK on any throw prevents a stranded open txn
 * from blocking every later write.
 */
function withTxn<T>(db: DatabaseSync, fn: () => T): T {
  if (db.isTransaction) return fn();
  db.exec("BEGIN IMMEDIATE");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch {}
    throw err;
  }
}

/**
 * Does a backup candidate open as a structurally-sound SQLite database? Opened read-only
 * so probing a slot never mutates it, and gated on PRAGMA integrity_check so page-level
 * damage a bare open would miss is caught before the slot is adopted (STORE-04). A missing
 * slot (errcode 14) or a corrupt slot (integrity_check throws 11/26) is caught → returns false.
 */
function opensClean(candidate: string): boolean {
  let probe: DatabaseSync | undefined;
  try {
    probe = new DatabaseSync(candidate, { readOnly: true });
    const row = probe.prepare("PRAGMA integrity_check").get() as
      { integrity_check?: string } | undefined;
    return row?.integrity_check === "ok";
  } catch {
    return false;
  } finally {
    try {
      probe?.close();
    } catch {}
  }
}

/**
 * Read-only storage-health probe for the preflight report (PRE-02). A missing `board.db` (fresh
 * install, before the store is ever loaded) counts as HEALTHY; otherwise the primary is opened
 * read-only via `opensClean` (DatabaseSync `{ readOnly: true }` + `PRAGMA integrity_check`).
 * @remarks Deliberately NEVER calls `connect()`, `openBoardDb()`, or `quarantineAndRecover()`: a
 * health probe must never rename, delete, or otherwise mutate `board.db` (Pitfall 4). `dispatch
 * doctor` and boot both call this without ever loading the store.
 */
export function probeStorageHealth(): { ok: boolean; path: string } {
  if (!fs.existsSync(BOARD_DB_PATH)) return { ok: true, path: BOARD_DB_PATH };
  return { ok: opensClean(BOARD_DB_PATH), path: BOARD_DB_PATH };
}

/**
 * The per-ticket workspace registry as `uninstall` reads it: every card's workspace folder plus the
 * source repos its worktrees were cut from. Returned RAW (never joined into worktree paths) because
 * that join lives in `services/domain/workspace-paths.ts` and store→services is a boundary violation — the
 * services caller owns the join.
 * @remarks Read-only by construction and tolerant to `[]` on a WHOLE-STORE failure (absent db,
 * missing `cards` table, unreadable file): this feeds the idempotent uninstall re-run, where a
 * half-removed footprint is a normal state, not an error. A PER-ROW failure (malformed JSON, a repo
 * entry with no `path`) skips only that row — discarding the whole list over one bad card would hide
 * every other card's worktrees from the uninstall report and orphan them exactly as this function
 * exists to prevent. NEVER calls `openBoardDb()` — that mkdirs `~/.dispatch` and CREATES board.db,
 * so a `--dry-run` on a clean box would materialize the very directory it claims not to touch.
 * Mirrors `probeStorageHealth`'s existsSync-guard + `{ readOnly: true }` discipline (Pitfall 4).
 */
export function readWorkspaceRegistry(): {
  workspacePath: string;
  repoPaths: string[];
}[] {
  if (!fs.existsSync(BOARD_DB_PATH)) return [];
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(BOARD_DB_PATH, { readOnly: true });
    const rows = db.prepare("SELECT data FROM cards").all() as {
      data: string;
    }[];
    const out: { workspacePath: string; repoPaths: string[] }[] = [];
    for (const row of rows) {
      try {
        const card = JSON.parse(row.data) as Card;
        if (!card.workspacePath) continue;
        out.push({
          workspacePath: card.workspacePath,
          repoPaths: (card.workspace?.repos ?? [])
            .map((r) => r?.path)
            .filter((p): p is string => typeof p === "string" && p.length > 0),
        });
      } catch {
        console.warn(
          "[store] skipping a malformed card row while reading the workspace registry.",
        );
      }
    }
    return out;
  } catch {
    return [];
  } finally {
    try {
      db?.close();
    } catch {}
  }
}

/**
 * Quarantine an unopenable/corrupt primary and recover from the newest clean snapshot
 * (STORE-04). Renames the bad primary to `board.db.corrupt` and removes its stale WAL
 * sidecars (so they cannot poison the restored copy), then walks `.bak.1`..`.bak.5`
 * newest-first, copying back the first slot that opens clean and logging a LOUD warning
 * naming the exact file used — a recovery is never silent. When the primary and every
 * slot fail, a fresh empty database is opened (also with a warning), so a corrupt file
 * can never crash boot (STORE-04 DoS mitigation). Reached ONLY on genuine corruption —
 * `connect()`'s classifier fails loud on every non-corruption open error and never calls this.
 */
function quarantineAndRecover(cause: unknown): DatabaseSync {
  console.warn(
    `[store] board.db failed to open cleanly (${(cause as Error).message}), quarantining and walking the backup chain.`,
  );
  try {
    if (fs.existsSync(BOARD_DB_PATH)) {
      fs.renameSync(BOARD_DB_PATH, `${BOARD_DB_PATH}.corrupt`);
    }
  } catch {}
  for (const ext of ["-wal", "-shm"]) {
    try {
      fs.rmSync(`${BOARD_DB_PATH}${ext}`, { force: true });
    } catch {}
  }
  for (let i = 1; i <= BACKUP_SLOTS; i++) {
    if (opensClean(bak(i))) {
      try {
        fs.copyFileSync(bak(i), BOARD_DB_PATH);
        const restored = new DatabaseSync(BOARD_DB_PATH);
        console.warn(
          `[store] recovered board.db from ${bak(i)} after the primary was corrupt/unopenable.`,
        );
        return restored;
      } catch {}
    }
  }
  console.warn(
    `[store] board.db and every backup slot were unreadable, starting with an empty database.`,
  );
  try {
    fs.rmSync(BOARD_DB_PATH, { force: true });
  } catch {}
  return new DatabaseSync(BOARD_DB_PATH);
}

/**
 * Open the primary and classify any open failure: genuine corruption (a thrown errcode 11/26
 * or a non-`ok` integrity_check row) self-heals via quarantineAndRecover, while EVERY other
 * failure (engine/load, EACCES, disk full, CANTOPEN, busy, unexpected JS error) throws a loud,
 * actionable Error and touches NOTHING — no rename, no slot walk, no delete of board.db or any
 * backup (SAFE-02/SAFE-03, the v1.7 data-loss fix). A MISSING primary on a fresh install is not
 * corruption — `new DatabaseSync` creates it and the empty db's integrity_check returns "ok".
 * @remarks `new DatabaseSync` opens lazily (does not throw on garbage), so integrity_check is
 * the FIRST file-touching op inside the guard — the errcode-throw it raises IS the corruption
 * signal. A plain Error (not StartupError) is thrown because a store→bootstrap import is
 * DAG-illegal; the bootstrap `main().catch` already prints thrown errors loud with a stack.
 */
function connect(): DatabaseSync {
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(BOARD_DB_PATH);
    const row = db.prepare("PRAGMA integrity_check").get() as
      { integrity_check?: string } | undefined;
    if (row?.integrity_check === "ok") return db;
    try {
      db.close();
    } catch {}
    return quarantineAndRecover(
      new Error(
        `integrity_check reported: ${row?.integrity_check ?? "unknown"}`,
      ),
    );
  } catch (err) {
    try {
      db?.close();
    } catch {}
    if (isCorruption(err)) return quarantineAndRecover(err);
    throw new Error(
      `[store] board.db at ${BOARD_DB_PATH} could not be opened and this is NOT corruption ` +
        `(${(err as Error).message}). board.db and every backup were left untouched. ` +
        `Fix the underlying problem (file permissions on ~/.dispatch, free disk space, or a ` +
        `stuck lock) and restart, dispatch will not quarantine or overwrite your data on a ` +
        `non-corruption error.`,
      { cause: err },
    );
  }
}

/**
 * Rebuild a BoardMeta from a loosely-typed parsed snapshot (import path), applying the
 * same defaulting hydrateFromParsed uses so an absent or malformed field lands as the
 * store's neutral value rather than propagating `undefined` into the meta blob.
 */
function toMeta(parsed: Partial<BoardSnapshot>): BoardMeta {
  return {
    syncedAt: typeof parsed.syncedAt === "string" ? parsed.syncedAt : null,
    workspaceFolders: Array.isArray(parsed.workspaceFolders)
      ? parsed.workspaceFolders
      : [],
    lastUsed: typeof parsed.lastUsed === "string" ? parsed.lastUsed : null,
  };
}

/**
 * Refuse to open a board whose persisted schema is newer than this build understands (`SESS-05`).
 *
 * @remarks A newer build may have moved data this build cannot read, so refusing is the only
 * option that is not a guess. It runs in `openBoardDb` before the boards migration and before any
 * statement is prepared, so the refusing boot changes nothing on disk.
 * @see docs/ARCHITECTURE.md#downgrade-safety
 */
export function assertSchemaOpenable(persistedSchemaVersion: number): void {
  if (persistedSchemaVersion <= STORE_SCHEMA_VERSION) return;
  throw new Error(
    `[store] ${BOARD_DB_PATH} was written by a NEWER version of dispatch than this one ` +
      `(board schema version ${persistedSchemaVersion}, this build understands ${STORE_SCHEMA_VERSION}). ` +
      `Opening it with this build would let it write a shape it cannot read back, silently ` +
      `desyncing your sessions, so it refused. Nothing was changed. board.db and every backup ` +
      `were left exactly as they were. Fix it by updating dispatch: run ` +
      `\`npx @theyashgupta/dispatch@latest\` (or restart the machine's dispatch service after ` +
      `updating) and start again. If you instead mean to stay on this older build, restore the ` +
      `pre-upgrade copy at ${BOARD_DB_PATH}.pre-boards over ${BOARD_DB_PATH} first, after you ` +
      `delete ${BOARD_DB_PATH}-wal and ${BOARD_DB_PATH}-shm. That file is ` +
      `your board as of before the newer version migrated it.`,
  );
}

const BOARD_KEY_TABLES = ["cards", "events", "archive"] as const;

function hasTable(db: DatabaseSync, name: string): boolean {
  return (
    db
      .prepare(
        "SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?",
      )
      .get(name) !== undefined
  );
}

function hasBoardKeyColumn(db: DatabaseSync, table: string): boolean {
  return (
    db
      .prepare(
        `SELECT 1 AS ok FROM pragma_table_info(?) WHERE name = 'board_key'`,
      )
      .get(table) !== undefined
  );
}

function persistedSchemaVersion(db: DatabaseSync): number | null {
  const row = db
    .prepare(
      "SELECT json_extract(data, '$.schemaVersion') AS v FROM meta WHERE id = 0",
    )
    .get() as { v: number | null } | undefined;
  return row === undefined ? null : (row.v ?? 0);
}

function hasBlobWithoutBoardKey(db: DatabaseSync, table: string): boolean {
  return (
    db
      .prepare(
        `SELECT 1 AS ok FROM ${table} WHERE json_extract(data, '$.boardKey') IS NULL LIMIT 1`,
      )
      .get() !== undefined
  );
}

function hasAnyRow(db: DatabaseSync): boolean {
  return BOARD_KEY_TABLES.some(
    (table) =>
      db.prepare(`SELECT 1 AS ok FROM ${table} LIMIT 1`).get() !== undefined,
  );
}

/**
 * Decide whether the boards migration has work to do, from the data and not only the counter.
 *
 * @remarks A board above {@link STORE_SCHEMA_VERSION} is never migrated, so the store's forward
 * guard can refuse it with nothing changed on disk.
 */
function boardsMigrationDue(db: DatabaseSync): boolean {
  const version = persistedSchemaVersion(db);
  if (version !== null && version > STORE_SCHEMA_VERSION) return false;
  return (
    !hasTable(db, "boards") ||
    BOARD_KEY_TABLES.some((table) => !hasBoardKeyColumn(db, table)) ||
    (version !== null && version < STORE_SCHEMA_VERSION) ||
    hasBlobWithoutBoardKey(db, "cards") ||
    hasBlobWithoutBoardKey(db, "archive")
  );
}

/**
 * Make `board.db.pre-v3` hold the same board as the fresh pre-boards copy.
 *
 * @remarks The 4.2 refusal message tells the user to restore `pre-v3`, and an older `pre-v3` from
 * the session-entity migration would roll the board back by months. The first older file is moved
 * aside, never deleted; a later one is this function's own earlier copy. Best effort like
 * `snapshotPreV3`: a failure is logged and the migration goes on, because the real rollback copy
 * is already on disk.
 */
function pointLegacyRestoreAtCopy(copyPath: string): void {
  const legacy = copyPath.replace(/\.pre-boards$/, ".pre-v3");
  if (legacy === copyPath) return;
  const aside = `${legacy}.before-boards`;
  const partial = `${legacy}.tmp`;
  try {
    if (fs.existsSync(legacy) && !fs.existsSync(aside))
      fs.renameSync(legacy, aside);
    fs.copyFileSync(copyPath, partial);
    fs.chmodSync(partial, 0o600);
    fs.renameSync(partial, legacy);
  } catch (err) {
    fs.rmSync(partial, { force: true });
    console.error(
      `[store] could not write ${legacy} (${(err as Error).message}). The rollback copy is ${copyPath}.`,
    );
  }
}

/**
 * Move a version 2 board onto the boards schema: every card, event and archive row goes to the
 * default board `LOCAL` (LOCAL-85, U1-06, U1-07).
 *
 * @remarks The copy at `copyPath` is written first. An existing copy is kept only when the
 * `boards` table exists, because then a pre-guard build re-ran the migration and the old copy is
 * the true pre-migration board. A failed copy or a failed transaction throws, so the server does
 * not start on a half-known state; the rollback leaves every table as it was.
 * @returns Whether the migration ran.
 */
export function migrateToBoards(
  db: DatabaseSync,
  copyPath: string,
  opts: { failInTransaction?: boolean } = {},
): boolean {
  if (!boardsMigrationDue(db)) return false;
  const keepCopy = hasTable(db, "boards") && fs.existsSync(copyPath);
  if (hasAnyRow(db) && !keepCopy) {
    const partial = `${copyPath}.tmp`;
    try {
      fs.rmSync(partial, { force: true });
      db.prepare("VACUUM INTO ?").run(partial);
      fs.chmodSync(partial, 0o600);
      fs.renameSync(partial, copyPath);
    } catch (err) {
      fs.rmSync(partial, { force: true });
      throw new Error(
        `[store] the boards migration could not write its pre-migration copy at ${copyPath} ` +
          `(${(err as Error).message}). The migration did not run and board.db is unchanged. ` +
          `Free disk space or fix the permissions of the data folder, then start again.`,
        { cause: err },
      );
    }
    pointLegacyRestoreAtCopy(copyPath);
  }
  try {
    withTxn(db, () => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS boards (
          key              TEXT PRIMARY KEY,
          name             TEXT NOT NULL,
          workspace_root   TEXT,
          repositories     TEXT NOT NULL,
          linear_team_keys TEXT NOT NULL,
          last_used_folder TEXT,
          policy           TEXT NOT NULL,
          created_at       TEXT NOT NULL,
          archived         INTEGER NOT NULL DEFAULT 0
        );
      `);
      for (const table of BOARD_KEY_TABLES) {
        if (!hasBoardKeyColumn(db, table)) {
          db.exec(
            `ALTER TABLE ${table} ADD COLUMN board_key TEXT NOT NULL DEFAULT '${DEFAULT_BOARD_KEY}'`,
          );
        }
      }
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_cards_board_key ON cards(board_key);
        CREATE INDEX IF NOT EXISTS idx_events_board_key_id ON events(board_key, id);
        CREATE INDEX IF NOT EXISTS idx_archive_board_key ON archive(board_key);
      `);
      db.prepare(
        `INSERT OR IGNORE INTO boards
           (key, name, workspace_root, repositories, linear_team_keys, last_used_folder, policy, created_at, archived)
         VALUES (?, 'Local', NULL, '[]', '[]', NULL, ?, ?, 0)`,
      ).run(
        DEFAULT_BOARD_KEY,
        JSON.stringify(defaultBoardPolicy(DEFAULT_BOARD_KEY)),
        new Date().toISOString(),
      );
      for (const table of ["cards", "archive"]) {
        db.prepare(
          `UPDATE ${table} SET data = json_set(data, '$.boardKey', board_key)
           WHERE json_extract(data, '$.boardKey') IS NULL`,
        ).run();
      }
      db.prepare(
        `UPDATE meta SET data = json_set(data, '$.schemaVersion', ?)
         WHERE id = 0 AND coalesce(json_extract(data, '$.schemaVersion'), 0) < ?`,
      ).run(STORE_SCHEMA_VERSION, STORE_SCHEMA_VERSION);
      if (opts.failInTransaction) throw new Error("forced migration failure");
    });
  } catch (err) {
    throw new Error(
      `[store] the boards migration failed and was rolled back (${(err as Error).message}). ` +
        `board.db is unchanged.` +
        (fs.existsSync(copyPath)
          ? ` The pre-migration copy is at ${copyPath}.`
          : ""),
      { cause: err },
    );
  }
  return true;
}

/**
 * Open (creating if absent) the board database at ~/.dispatch/board.db, set the WAL
 * durability pragmas, ensure the two-table schema, and return the typed store surface.
 * The DB is created inside the mode-700 ~/.dispatch dir (SECURITY: same at-rest
 * protection board.json had). Prepared statements are compiled once here and reused for
 * every mutation. Card and meta values cross into SQL ONLY as bound parameters
 * (`@id`/`@data`/`?` + json_each) — never string-concatenated, so card text (incl.
 * Linear-sourced content) cannot inject SQL (STORE tampering mitigation). The open
 * self-heals a corrupt primary from the newest clean snapshot (connect), and
 * `backupTick` folds an hourly WAL-consistent snapshot into the `.bak.N` chain.
 * @remarks On first open any pre-existing WAL (e.g. from the previous native engine) is folded in via
 * `wal_checkpoint(TRUNCATE)` before any rotation, and `busy_timeout` is set explicitly
 * (node:sqlite defaults to 0) so an hourly snapshot read-lock retries instead of throwing.
 * The boards migration runs before any statement is prepared, and the open throws when that
 * migration cannot write its copy or commit.
 * @see docs/ARCHITECTURE.md#single-writer-store
 */
export function openBoardDb(): BoardDb {
  fs.mkdirSync(DISPATCH_DATA_DIR, { recursive: true, mode: 0o700 });
  const db = connect();
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  try {
    db.prepare("SELECT value FROM json_each('[]')").all();
  } catch (err) {
    try {
      db.close();
    } catch {}
    throw new Error(
      `[store] this Node build's SQLite lacks the JSON1 json_each() function the board store ` +
        `requires (${(err as Error).message}). Use a standard Node build with JSON1 enabled.`,
      { cause: err },
    );
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS cards (
      id   TEXT PRIMARY KEY,
      data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS meta (
      id   INTEGER PRIMARY KEY CHECK (id = 0),
      data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS events (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      card_id  TEXT,
      type     TEXT NOT NULL,
      from_col TEXT,
      to_col   TEXT,
      reason   TEXT,
      source   TEXT,
      ts       TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_events_card_id ON events(card_id);
    CREATE TABLE IF NOT EXISTS archive (
      id          TEXT PRIMARY KEY,
      data        TEXT NOT NULL,
      archived_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      endpoint   TEXT PRIMARY KEY,
      p256dh     TEXT NOT NULL,
      auth       TEXT NOT NULL,
      origin     TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS items (
      id     TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      state  TEXT NOT NULL,
      data   TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_items_source_state ON items(source, state);
  `);
  try {
    assertSchemaOpenable(persistedSchemaVersion(db) ?? 0);
    migrateToBoards(db, `${BOARD_DB_PATH}.pre-boards`);
  } catch (err) {
    try {
      db.close();
    } catch {}
    throw err;
  }

  const upsertCard = db.prepare(
    `INSERT INTO cards (id, data, board_key) VALUES (@id, @data, @boardKey)
     ON CONFLICT(id) DO UPDATE SET data = excluded.data, board_key = excluded.board_key`,
  );
  const deleteGone = db.prepare(
    `DELETE FROM cards WHERE id NOT IN (SELECT value FROM json_each(?))`,
  );
  const writeMeta = db.prepare(
    `INSERT INTO meta (id, data) VALUES (0, @data)
     ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
  );
  const selectCards = db.prepare(`SELECT data FROM cards`);
  const selectMeta = db.prepare(`SELECT data FROM meta WHERE id = 0`);
  const countCards = db.prepare(`SELECT COUNT(*) AS n FROM cards`);
  const insertEvent = db.prepare(
    `INSERT INTO events (card_id, type, from_col, to_col, reason, source, ts, board_key)
     VALUES (@cardId, @type, @fromCol, @toCol, @reason, @source, @ts, @boardKey)`,
  );
  const selectEvents = db.prepare(
    `SELECT id, card_id, type, from_col, to_col, reason, source, ts, board_key
       FROM events WHERE board_key = ? ORDER BY id DESC LIMIT ?`,
  );
  const selectEventsByCard = db.prepare(
    `SELECT id, card_id, type, from_col, to_col, reason, source, ts, board_key
       FROM events WHERE board_key = ? AND card_id = ? ORDER BY id DESC LIMIT ?`,
  );
  const evictExcessPushSubscriptions = db.prepare(
    `DELETE FROM push_subscriptions
      WHERE NOT EXISTS (SELECT 1 FROM push_subscriptions WHERE endpoint = @endpoint)
        AND endpoint IN (
          SELECT endpoint FROM push_subscriptions
           ORDER BY created_at
           LIMIT MAX(0, (SELECT COUNT(*) FROM push_subscriptions) - ${MAX_PUSH_SUBSCRIPTIONS - 1}))`,
  );
  const upsertPushSubscription = db.prepare(
    `INSERT INTO push_subscriptions (endpoint, p256dh, auth, origin, created_at)
     SELECT @endpoint, @p256dh, @auth, @origin, @createdAt
     WHERE (SELECT COUNT(*) FROM push_subscriptions) < ${MAX_PUSH_SUBSCRIPTIONS}
        OR EXISTS (SELECT 1 FROM push_subscriptions WHERE endpoint = @endpoint)
     ON CONFLICT(endpoint) DO UPDATE SET
       p256dh = excluded.p256dh, auth = excluded.auth, origin = excluded.origin,
       created_at = excluded.created_at`,
  );
  const deletePushSubscription = db.prepare(
    `DELETE FROM push_subscriptions WHERE endpoint = ?`,
  );
  const upsertArchive = db.prepare(
    `INSERT INTO archive (id, data, archived_at, board_key) VALUES (@id, @data, @archivedAt, @boardKey)
     ON CONFLICT(id) DO UPDATE SET data = excluded.data, archived_at = excluded.archived_at, board_key = excluded.board_key`,
  );
  const deleteArchive = db.prepare(`DELETE FROM archive WHERE id = ?`);
  const selectArchiveById = db.prepare(`SELECT data FROM archive WHERE id = ?`);
  const selectArchive = db.prepare(
    `SELECT data FROM archive ORDER BY archived_at DESC, id ASC`,
  );
  const selectPushSubscriptions = db.prepare(
    `SELECT endpoint, p256dh, auth, origin, created_at FROM push_subscriptions`,
  );
  const upsertItem = db.prepare(
    `INSERT INTO items (id, source, state, data) VALUES (@id, @source, @state, @data)
     ON CONFLICT(id) DO UPDATE SET source = excluded.source, state = excluded.state, data = excluded.data`,
  );
  const selectItems = db.prepare(`SELECT id, data FROM items`);
  const selectBoards = db.prepare(
    `SELECT * FROM boards ORDER BY created_at, key`,
  );
  const upsertBoard = db.prepare(
    `INSERT INTO boards (key, name, workspace_root, repositories, linear_team_keys, last_used_folder, policy, created_at, archived)
     VALUES (@key, @name, @workspaceRoot, @repositories, @linearTeamKeys, @lastUsedFolder, @policy, @createdAt, @archived)
     ON CONFLICT(key) DO UPDATE SET name = excluded.name, workspace_root = excluded.workspace_root,
       repositories = excluded.repositories, linear_team_keys = excluded.linear_team_keys,
       last_used_folder = excluded.last_used_folder, policy = excluded.policy, archived = excluded.archived`,
  );

  function persistTxn(
    cards: Card[],
    meta: BoardMeta,
    events: Omit<ActivityEvent | AccountActivityEvent, "id">[],
    itemWrites?: ItemWrites,
    boards: Board[] = [],
  ): number[] {
    return withTxn(db, () => {
      for (const board of boards) {
        upsertBoard.run({
          key: board.key,
          name: board.name,
          workspaceRoot: board.workspaceRoot,
          repositories: JSON.stringify(board.repositories),
          linearTeamKeys: JSON.stringify(board.linearTeamKeys),
          lastUsedFolder: board.lastUsedFolder,
          policy: JSON.stringify(board.policy),
          createdAt: board.createdAt,
          archived: board.archived ? 1 : 0,
        });
      }
      const ids: string[] = [];
      for (const card of cards) {
        const boardKey = card.boardKey ?? DEFAULT_BOARD_KEY;
        upsertCard.run({
          id: card.id,
          data: JSON.stringify({ ...card, boardKey }),
          boardKey,
        });
        ids.push(card.id);
      }
      deleteGone.run(JSON.stringify(ids));
      writeMeta.run({ data: JSON.stringify(meta) });
      for (const item of itemWrites?.upserts ?? []) {
        upsertItem.run({
          id: item.id,
          source: item.source,
          state: item.state,
          data: JSON.stringify(item),
        });
      }
      const eventIds: number[] = [];
      for (const e of events) {
        const info = insertEvent.run({
          cardId: e.cardId ?? null,
          type: e.type,
          fromCol: e.fromCol ?? null,
          toCol: e.toCol ?? null,
          reason: e.reason ?? null,
          source: e.source ?? null,
          ts: e.ts,
          boardKey: e.boardKey ?? DEFAULT_BOARD_KEY,
        });
        eventIds.push(Number(info.lastInsertRowid));
      }
      return eventIds;
    });
  }

  let backupFailureLogged = false;

  return {
    cardCount() {
      return (countCards.get() as { n: number }).n;
    },
    readAllItems() {
      const items: Item[] = [];
      for (const row of selectItems.all() as { id: string; data: string }[]) {
        try {
          items.push(JSON.parse(row.data) as Item);
        } catch {
          console.error(`[board-db] skipping unreadable items row ${row.id}`);
        }
      }
      return items;
    },
    readAll() {
      const cards = (selectCards.all() as { data: string }[]).map(
        (row) => JSON.parse(row.data) as Card,
      );
      const metaRow = selectMeta.get() as { data: string } | undefined;
      const meta = metaRow
        ? (JSON.parse(metaRow.data) as Partial<BoardMeta>)
        : {};
      return { cards, meta };
    },
    readBoards() {
      return (selectBoards.all() as unknown as BoardRow[]).map((row) => ({
        key: row.key as BoardKey,
        name: row.name,
        workspaceRoot: row.workspace_root,
        repositories: JSON.parse(row.repositories) as Board["repositories"],
        linearTeamKeys: JSON.parse(row.linear_team_keys) as string[],
        lastUsedFolder: row.last_used_folder,
        policy: JSON.parse(row.policy) as Board["policy"],
        createdAt: row.created_at,
        archived: row.archived === 1,
      }));
    },
    persist(cards, meta, events, itemWrites, boards) {
      return persistTxn(cards, meta, events, itemWrites, boards);
    },
    importParsed(parsed) {
      const cards = Array.isArray(parsed.cards) ? parsed.cards : [];
      persistTxn(cards, toMeta(parsed), []);
    },
    listEvents(board, cardId, limit) {
      const rows = (cardId == null
        ? selectEvents.all(board, limit)
        : selectEventsByCard.all(
            board,
            cardId,
            limit,
          )) as unknown as EventRow[];
      return rows.map((r) => ({
        id: r.id,
        cardId: r.card_id,
        type: r.type as EventType,
        fromCol: r.from_col as Column | null,
        toCol: r.to_col as Column | null,
        reason: r.reason,
        source: r.source,
        ts: r.ts,
        boardKey: r.board_key as BoardKey,
      }));
    },
    backupTick(force?: boolean): Promise<void> {
      try {
        let elapsed = true;
        if (!force) {
          try {
            const { mtimeMs } = fs.statSync(bak(1));
            elapsed = Date.now() - mtimeMs >= HOUR_MS;
          } catch {}
        }
        if (elapsed) {
          const tmp = `${BOARD_DB_PATH}.bak.tmp`;
          fs.rmSync(tmp, { force: true });
          db.prepare("VACUUM INTO ?").run(tmp);
          for (let i = BACKUP_SLOTS - 1; i >= 1; i--) {
            try {
              fs.renameSync(bak(i), bak(i + 1));
            } catch {}
          }
          fs.renameSync(tmp, bak(1));
        }
      } catch (err) {
        if (!backupFailureLogged) {
          backupFailureLogged = true;
          console.error(
            "[store] board.db backup failed (primary write unaffected):",
            (err as Error).message,
          );
        }
      }
      return Promise.resolve();
    },
    snapshotPreV3() {
      const target = `${BOARD_DB_PATH}.pre-v3`;
      try {
        if (!fs.existsSync(target)) {
          db.prepare("VACUUM INTO ?").run(target);
        }
      } catch (err) {
        console.error(
          "[store] board.db.pre-v3 snapshot failed (migration proceeds unaffected):",
          (err as Error).message,
        );
      }
    },
    upsertArchive(row) {
      const boardKey = row.boardKey ?? row.card.boardKey ?? DEFAULT_BOARD_KEY;
      upsertArchive.run({
        id: row.id,
        data: JSON.stringify({ ...row, boardKey }),
        archivedAt: row.archivedAt,
        boardKey,
      });
    },
    deleteArchive(id) {
      const info = deleteArchive.run(id);
      return Number(info.changes) > 0;
    },
    getArchive(id) {
      const row = selectArchiveById.get(id) as { data: string } | undefined;
      return row ? (JSON.parse(row.data) as ArchivedGroup) : undefined;
    },
    listArchive() {
      const rows = selectArchive.all() as { data: string }[];
      return rows.map((r) => JSON.parse(r.data) as ArchivedGroup);
    },
    addPushSubscription(sub) {
      evictExcessPushSubscriptions.run({ endpoint: sub.endpoint });
      const info = upsertPushSubscription.run({
        endpoint: sub.endpoint,
        p256dh: sub.p256dh,
        auth: sub.auth,
        origin: sub.origin,
        createdAt: sub.createdAt,
      });
      return Number(info.changes) > 0;
    },
    removePushSubscription(endpoint) {
      const info = deletePushSubscription.run(endpoint);
      return Number(info.changes) > 0;
    },
    listPushSubscriptions() {
      const rows = selectPushSubscriptions.all() as {
        endpoint: string;
        p256dh: string;
        auth: string;
        origin: string;
        created_at: string;
      }[];
      return rows.map((r) => ({
        endpoint: r.endpoint,
        p256dh: r.p256dh,
        auth: r.auth,
        origin: r.origin,
        createdAt: r.created_at,
      }));
    },
  };
}
