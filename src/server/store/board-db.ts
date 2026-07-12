import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
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
 * better-sqlite3 is touched. `persist` writes the FULL card set (including each
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

/** Raw `events` row shape (snake_case columns) before the read-path snake→camel map. */
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
 * Does a backup candidate open as a structurally-sound SQLite database? Opened read-only
 * so probing a slot never mutates it, and gated on PRAGMA integrity_check so page-level
 * damage a bare open would miss is caught before the slot is adopted (STORE-04).
 */
function opensClean(candidate: string): boolean {
  try {
    const probe = new Database(candidate, {
      readonly: true,
      fileMustExist: true,
    });
    const ok = probe.pragma("integrity_check", { simple: true }) === "ok";
    probe.close();
    return ok;
  } catch {
    return false;
  }
}

/**
 * Quarantine an unopenable/corrupt primary and recover from the newest clean snapshot
 * (STORE-04). Renames the bad primary to `board.db.corrupt` and removes its stale WAL
 * sidecars (so they cannot poison the restored copy), then walks `.bak.1`..`.bak.5`
 * newest-first, copying back the first slot that opens clean and logging a LOUD warning
 * naming the exact file used — a recovery is never silent. When the primary and every
 * slot fail, a fresh empty database is opened (also with a warning), so a corrupt file
 * can never crash boot (STORE-04 DoS mitigation).
 */
function quarantineAndRecover(cause: unknown): Database.Database {
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
        const restored = new Database(BOARD_DB_PATH);
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
  return new Database(BOARD_DB_PATH);
}

/**
 * Open the primary with BOTH a constructor try/catch AND a PRAGMA integrity_check, the two
 * complementary corruption detectors: the catch handles a file too damaged to open at all,
 * the pragma handles one that opens but has damaged pages. On either failure the connection
 * self-heals via quarantineAndRecover. A MISSING primary on a fresh install is not corruption
 * — `new Database` creates it and an empty board follows (STORE-02).
 */
function connect(): Database.Database {
  let db: Database.Database | undefined;
  try {
    db = new Database(BOARD_DB_PATH);
    if (db.pragma("integrity_check", { simple: true }) === "ok") return db;
    db.close();
    throw new Error("integrity_check reported corruption");
  } catch (err) {
    if (db?.open) db.close();
    return quarantineAndRecover(err);
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
 * @see docs/ARCHITECTURE.md#single-writer-store
 */
export function openBoardDb(): BoardDb {
  fs.mkdirSync(BOARD_DIR, { recursive: true, mode: 0o700 });
  const db = connect();
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
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

  const persistTxn = db.transaction(
    (
      cards: Card[],
      meta: BoardMeta,
      events: Omit<ActivityEvent, "id">[],
    ): number[] => {
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
    },
  );

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
      const rows = (
        cardId == null
          ? selectEvents.all(limit)
          : selectEventsByCard.all(cardId, limit)
      ) as EventRow[];
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
    async backupTick() {
      try {
        let elapsed = true;
        try {
          const { mtimeMs } = fs.statSync(bak(1));
          elapsed = Date.now() - mtimeMs >= HOUR_MS;
        } catch {}
        if (!elapsed) return;
        const tmp = `${BOARD_DB_PATH}.bak.tmp`;
        await db.backup(tmp);
        for (let i = BACKUP_SLOTS - 1; i >= 1; i--) {
          try {
            fs.renameSync(bak(i), bak(i + 1));
          } catch {}
        }
        fs.renameSync(tmp, bak(1));
      } catch (err) {
        if (!backupFailureLogged) {
          backupFailureLogged = true;
          console.error(
            "[store] board.db backup failed (primary write unaffected):",
            (err as Error).message,
          );
        }
      }
    },
  };
}
