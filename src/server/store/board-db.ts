import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import type { BoardSnapshot, Card } from "../../shared/types.js";

const BOARD_DIR = path.join(os.homedir(), ".dispatch");
export const BOARD_DB_PATH = path.join(BOARD_DIR, "board.db");

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
  persist(cards: Card[], meta: BoardMeta): void;
  importParsed(parsed: Partial<BoardSnapshot>): void;
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
 * Linear-sourced content) cannot inject SQL (STORE tampering mitigation).
 * @see docs/ARCHITECTURE.md#single-writer-store
 */
export function openBoardDb(): BoardDb {
  fs.mkdirSync(BOARD_DIR, { recursive: true, mode: 0o700 });
  const db = new Database(BOARD_DB_PATH);
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

  const persistTxn = db.transaction((cards: Card[], meta: BoardMeta) => {
    const ids: string[] = [];
    for (const card of cards) {
      upsertCard.run({ id: card.id, data: JSON.stringify(card) });
      ids.push(card.id);
    }
    deleteGone.run(JSON.stringify(ids));
    writeMeta.run({ data: JSON.stringify(meta) });
  });

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
    persist(cards, meta) {
      persistTxn(cards, meta);
    },
    importParsed(parsed) {
      const cards = Array.isArray(parsed.cards) ? parsed.cards : [];
      persistTxn(cards, toMeta(parsed));
    },
  };
}
