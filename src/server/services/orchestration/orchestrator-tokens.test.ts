import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { isolateEnv } from "../../test-support/fixtures.js";
import { parseBoardKey } from "../../../shared/board-key.js";
import type { BoardKey } from "../../../shared/types.js";

const env = isolateEnv();
const { store } = await import("../../store/board.store.js");
const { BOARD_DB_PATH } = await import("../../store/board-db.js");
const {
  mintOrchestratorToken,
  resolveOrchestratorToken,
  revokeOrchestratorToken,
} = await import("./orchestrator-tokens.js");

await store.load();
after(() => env.cleanup());

const SBX = parseBoardKey("SBX") as BoardKey;

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function storedRows(): { token_hash: string; revoked_at: string | null }[] {
  const raw = new DatabaseSync(BOARD_DB_PATH, { readOnly: true });
  try {
    return raw
      .prepare(
        "SELECT token_hash, revoked_at FROM orchestrator_tokens ORDER BY rowid",
      )
      .all() as { token_hash: string; revoked_at: string | null }[];
  } finally {
    raw.close();
  }
}

function databaseBytesHold(text: string): boolean {
  return [BOARD_DB_PATH, `${BOARD_DB_PATH}-wal`].some(
    (file) => fs.existsSync(file) && fs.readFileSync(file).includes(text),
  );
}

void test("mint returns a 64 hex character token that resolves to its orchestrator", () => {
  const token = mintOrchestratorToken({
    boardKey: SBX,
    orchestratorId: "orc-a",
  });
  assert.match(token, /^[0-9a-f]{64}$/);
  assert.deepEqual(resolveOrchestratorToken(token), {
    boardKey: SBX,
    orchestratorId: "orc-a",
    revoked: false,
  });
  assert.equal(resolveOrchestratorToken("f".repeat(64)), undefined);
});

void test("the database holds the sha256 of the token and never the raw token", () => {
  const token = mintOrchestratorToken({
    boardKey: SBX,
    orchestratorId: "orc-b",
  });
  const hashes = storedRows().map((r) => r.token_hash);
  assert.ok(hashes.includes(sha256(token)));
  assert.ok(!hashes.includes(token));
  assert.equal(databaseBytesHold(token), false, "raw token in db or wal bytes");
  const raw = new DatabaseSync(BOARD_DB_PATH);
  raw.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  raw.close();
  assert.equal(
    databaseBytesHold(token),
    false,
    "raw token in db bytes after checkpoint",
  );
  assert.equal(databaseBytesHold(sha256(token)), true);
});

void test("revoke makes the token resolve as revoked and reports the count", () => {
  const identity = { boardKey: SBX, orchestratorId: "orc-c" };
  const token = mintOrchestratorToken(identity);
  assert.equal(revokeOrchestratorToken(identity), 1);
  assert.equal(resolveOrchestratorToken(token)?.revoked, true);
  assert.equal(revokeOrchestratorToken(identity), 0);
});

void test("a second mint for the same orchestrator revokes the first token", () => {
  const identity = { boardKey: SBX, orchestratorId: "orc-d" };
  const first = mintOrchestratorToken(identity);
  const second = mintOrchestratorToken(identity);
  assert.notEqual(first, second);
  assert.equal(resolveOrchestratorToken(first)?.revoked, true);
  assert.equal(resolveOrchestratorToken(second)?.revoked, false);
  const other = mintOrchestratorToken({
    boardKey: SBX,
    orchestratorId: "orc-e",
  });
  assert.equal(resolveOrchestratorToken(second)?.revoked, false);
  assert.equal(resolveOrchestratorToken(other)?.revoked, false);
});

void test("a token still resolves after the store is reloaded from disk", async () => {
  const live = mintOrchestratorToken({
    boardKey: SBX,
    orchestratorId: "orc-f",
  });
  const revokedIdentity = { boardKey: SBX, orchestratorId: "orc-g" };
  const revoked = mintOrchestratorToken(revokedIdentity);
  revokeOrchestratorToken(revokedIdentity);
  await store.load();
  assert.deepEqual(resolveOrchestratorToken(live), {
    boardKey: SBX,
    orchestratorId: "orc-f",
    revoked: false,
  });
  assert.equal(resolveOrchestratorToken(revoked)?.revoked, true);
});
