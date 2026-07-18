import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  ActivityEvent,
  BoardSnapshot,
  Card,
  Column,
  EventType,
} from "../../shared/types.js";

const BOARD_DIR = path.join(os.homedir(), ".dispatch");
export const BOARD_DB_PATH = path.join(BOARD_DIR, "board.db");

/** Hardcoded snapshot-backup slot count (`.bak.1` .. `.bak.5`); no config surface (BAK-01). */
export const BACKUP_SLOTS = 5;

const HOUR_MS = 3_600_000;

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
  persist(
    cards: Card[],
    meta: BoardMeta,
    events: Omit<ActivityEvent, "id">[],
  ): number[];
  importParsed(parsed: Partial<BoardSnapshot>): void;
  listEvents(cardId: string | null, limit: number): ActivityEvent[];
  backupTick(): Promise<void>;
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
    `[store] board.db failed to open cleanly (${(cause as Error).message}) — quarantining and walking the backup chain.`,
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
    `[store] board.db and every backup slot were unreadable — starting with an empty database.`,
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
        `stuck lock) and restart — dispatch will not quarantine or overwrite your data on a ` +
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
 * @see docs/ARCHITECTURE.md#single-writer-store
 */
export function openBoardDb(): BoardDb {
  fs.mkdirSync(BOARD_DIR, { recursive: true, mode: 0o700 });
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
  `);

  const upsertCard = db.prepare(
    `INSERT INTO cards (id, data) VALUES (@id, @data)
     ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
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
    `INSERT INTO events (card_id, type, from_col, to_col, reason, source, ts)
     VALUES (@cardId, @type, @fromCol, @toCol, @reason, @source, @ts)`,
  );
  const selectEvents = db.prepare(
    `SELECT id, card_id, type, from_col, to_col, reason, source, ts
       FROM events ORDER BY id DESC LIMIT ?`,
  );
  const selectEventsByCard = db.prepare(
    `SELECT id, card_id, type, from_col, to_col, reason, source, ts
       FROM events WHERE card_id = ? ORDER BY id DESC LIMIT ?`,
  );

  function persistTxn(
    cards: Card[],
    meta: BoardMeta,
    events: Omit<ActivityEvent, "id">[],
  ): number[] {
    return withTxn(db, () => {
      const ids: string[] = [];
      for (const card of cards) {
        upsertCard.run({ id: card.id, data: JSON.stringify(card) });
        ids.push(card.id);
      }
      deleteGone.run(JSON.stringify(ids));
      writeMeta.run({ data: JSON.stringify(meta) });
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
    persist(cards, meta, events) {
      return persistTxn(cards, meta, events);
    },
    importParsed(parsed) {
      const cards = Array.isArray(parsed.cards) ? parsed.cards : [];
      persistTxn(cards, toMeta(parsed), []);
    },
    listEvents(cardId, limit) {
      const rows = (cardId == null
        ? selectEvents.all(limit)
        : selectEventsByCard.all(cardId, limit)) as unknown as EventRow[];
      return rows.map((r) => ({
        id: r.id,
        cardId: r.card_id,
        type: r.type as EventType,
        fromCol: r.from_col as Column | null,
        toCol: r.to_col as Column | null,
        reason: r.reason,
        source: r.source,
        ts: r.ts,
      }));
    },
    backupTick(): Promise<void> {
      try {
        let elapsed = true;
        try {
          const { mtimeMs } = fs.statSync(bak(1));
          elapsed = Date.now() - mtimeMs >= HOUR_MS;
        } catch {}
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
  };
}
