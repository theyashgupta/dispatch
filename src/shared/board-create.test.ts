import assert from "node:assert/strict";
import { test } from "node:test";
import type { BoardKey } from "./types.js";
import { createdBoardText } from "./board-create.js";

test("the created line names the board and its key", () => {
  assert.equal(
    createdBoardText({ name: "Acme Corp", key: "ACME" as BoardKey }),
    "Created board Acme Corp (ACME)",
  );
});
