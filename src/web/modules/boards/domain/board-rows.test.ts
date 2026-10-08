import assert from "node:assert/strict";
import { test } from "node:test";
import type { Board, BoardKey } from "../../../../shared/types.js";
import { boardRows } from "./board-rows.js";

function board(key: string, archived = false): Board {
  return { key: key as BoardKey, name: key, archived } as Board;
}

test("boardRows lists active boards with counts, clash and archive action", () => {
  const rows = boardRows(
    [board("LOCAL"), board("ACME"), board("OLD", true)],
    [
      { key: "LOCAL" as BoardKey, running: 3, openGroups: 1, attention: 0 },
      { key: "ACME" as BoardKey, running: 2, openGroups: 0, attention: 4 },
    ],
    ["ACME"],
  );
  assert.deepEqual(
    rows.map((row) => row.board.key),
    ["LOCAL", "ACME"],
  );
  assert.equal(rows[0]?.counts?.running, 3);
  assert.deepEqual(rows[0]?.archive, { kind: "none" });
  assert.equal(rows[1]?.keyClash, true);
  assert.equal(rows[1]?.archive.kind, "disabled");
});

test("boardRows keeps null counts while the counts are unknown", () => {
  const rows = boardRows([board("ACME")], undefined, []);
  assert.equal(rows[0]?.counts, null);
  assert.deepEqual(rows[0]?.archive, { kind: "enabled" });
});
