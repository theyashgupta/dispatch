import assert from "node:assert/strict";
import { test } from "node:test";
import {
  boardKeyFromPath,
  boardSearch,
  boardSwitchTarget,
  cardBoardSwitch,
  entryBoard,
  isArchivedSettingsPath,
  resolveBoardParam,
  selectBoard,
  staleCountsLabel,
  withBoard,
  type BoardEntry,
  unavailableBoardMessage,
} from "./board-select.js";
import type { BoardKey } from "./types.js";

const LOCAL = "LOCAL" as BoardKey;
const ACME = "ACME" as BoardKey;

const boards: BoardEntry[] = [
  { key: LOCAL, archived: false },
  { key: ACME, archived: false },
  { key: "OLD" as BoardKey, archived: true },
];

test("selectBoard resolves an absent param to LOCAL", () => {
  assert.deepEqual(selectBoard(undefined, boards), {
    key: LOCAL,
    unavailable: null,
  });
  assert.deepEqual(selectBoard(undefined, undefined), {
    key: LOCAL,
    unavailable: null,
  });
});

test("selectBoard resolves the LOCAL param to LOCAL", () => {
  assert.deepEqual(selectBoard("LOCAL", boards), {
    key: LOCAL,
    unavailable: null,
  });
  assert.deepEqual(selectBoard("LOCAL", undefined), {
    key: LOCAL,
    unavailable: null,
  });
});

test("selectBoard keeps a known active key", () => {
  assert.deepEqual(selectBoard("ACME", boards), {
    key: ACME,
    unavailable: null,
  });
});

test("selectBoard falls back to LOCAL for an unknown key and names it", () => {
  assert.deepEqual(selectBoard("NOPE", boards), {
    key: LOCAL,
    unavailable: "NOPE",
  });
});

test("selectBoard falls back to LOCAL for an archived key and names it", () => {
  assert.deepEqual(selectBoard("OLD", boards), {
    key: LOCAL,
    unavailable: "OLD",
  });
});

test("selectBoard trusts a string param while the list is loading", () => {
  assert.deepEqual(selectBoard("ACME", undefined), {
    key: ACME,
    unavailable: null,
  });
});

test("selectBoard trusts a well-formed key that is on no list while the list is loading", () => {
  assert.deepEqual(selectBoard("GROUP", undefined), {
    key: "GROUP" as BoardKey,
    unavailable: null,
  });
});

test("selectBoard treats a string that is not a board key as unavailable while the list is loading", () => {
  for (const param of ["acme", "A", "TOOLONGKEY", "A&B=C", "", "1ABC"]) {
    assert.deepEqual(selectBoard(param, undefined), {
      key: LOCAL,
      unavailable: param,
    });
  }
});

test("selectBoard falls back to LOCAL for a non-string param while the list is loading", () => {
  assert.deepEqual(selectBoard(7, undefined), {
    key: LOCAL,
    unavailable: "7",
  });
  assert.deepEqual(selectBoard({ a: 1 }, undefined), {
    key: LOCAL,
    unavailable: '{"a":1}',
  });
});

test("selectBoard falls back to LOCAL for a number param after the list loads", () => {
  assert.deepEqual(selectBoard(7, boards), { key: LOCAL, unavailable: "7" });
});

test("boardSearch drops the parameter for LOCAL and keeps it for ACME", () => {
  assert.deepEqual(boardSearch(LOCAL), { board: undefined });
  assert.deepEqual(boardSearch(ACME), { board: ACME });
});

test("withBoard leaves a LOCAL path unchanged", () => {
  assert.equal(withBoard("/api/board", LOCAL), "/api/board");
  assert.equal(
    withBoard("/api/board?doneLimit=5", LOCAL),
    "/api/board?doneLimit=5",
  );
});

test("withBoard starts the query for a path without one", () => {
  assert.equal(withBoard("/api/board", ACME), "/api/board?board=ACME");
});

test("withBoard appends to the query of a path that has one", () => {
  assert.equal(
    withBoard("/api/board?doneLimit=5", ACME),
    "/api/board?doneLimit=5&board=ACME",
  );
});

test("withBoard URL-encodes the key", () => {
  assert.equal(
    withBoard("/api/board", "A&B=C" as BoardKey),
    "/api/board?board=A%26B%3DC",
  );
});

test("entryBoard is null when nothing is remembered", () => {
  assert.equal(entryBoard(null, boards), null);
});

test("entryBoard is null for a remembered LOCAL", () => {
  assert.equal(entryBoard("LOCAL", boards), null);
});

test("entryBoard returns a remembered active board", () => {
  assert.equal(entryBoard("ACME", boards), ACME);
});

test("entryBoard is null for a remembered archived board", () => {
  assert.equal(entryBoard("OLD", boards), null);
});

test("entryBoard is null for a remembered unknown board", () => {
  assert.equal(entryBoard("NOPE", boards), null);
});

test("entryBoard is null while the list is loading", () => {
  assert.equal(entryBoard("ACME", undefined), null);
});

test("cardBoardSwitch returns the card board only when it differs from the selected board", () => {
  assert.equal(cardBoardSwitch(ACME, LOCAL), ACME);
  assert.equal(cardBoardSwitch(ACME, ACME), null);
  assert.equal(cardBoardSwitch(undefined, LOCAL), null);
  assert.equal(cardBoardSwitch(undefined, ACME), LOCAL);
  assert.equal(cardBoardSwitch(LOCAL, ACME), LOCAL);
  assert.equal(cardBoardSwitch(LOCAL, LOCAL), null);
});

test("staleCountsLabel names the last good time only after a failed refetch with data", () => {
  const data = { at: "2026-10-07T09:05:00.000Z" };
  const time = new Date(data.at).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  assert.equal(
    staleCountsLabel({ isError: true, data }),
    `Counts from ${time}`,
  );
  assert.equal(staleCountsLabel({ isError: false, data }), null);
  assert.equal(staleCountsLabel({ isError: true, data: undefined }), null);
});

test("unavailableBoardMessage names a well-formed key and never echoes other text", () => {
  assert.equal(unavailableBoardMessage("NOPE"), "Board NOPE is not available.");
  for (const text of ["acme", "PAY 500 NOW", '{"a":1}', ""]) {
    assert.equal(
      unavailableBoardMessage(text),
      "This board link is not valid.",
    );
  }
});

test("boardKeyFromPath reads the key of a board path", () => {
  assert.equal(boardKeyFromPath("/boards/NIMBUS"), "NIMBUS");
  assert.equal(boardKeyFromPath("/boards/NIMBUS/inbox/x"), "NIMBUS");
});

test("boardKeyFromPath returns null for paths with no key", () => {
  for (const path of ["/boards", "/boards/", "/board", "/inbox"]) {
    assert.equal(boardKeyFromPath(path), null);
  }
});

test("boardKeyFromPath does not validate the key", () => {
  assert.equal(boardKeyFromPath("/boards/nimbus"), "nimbus");
});

test("resolveBoardParam lets the path key beat a different search key", () => {
  assert.deepEqual(resolveBoardParam("/boards/ACME/inbox", "OTHER"), {
    param: "ACME",
    stripSearchBoard: true,
  });
});

test("resolveBoardParam uses the search key when the path has none", () => {
  assert.deepEqual(resolveBoardParam("/inbox", "ACME"), {
    param: "ACME",
    stripSearchBoard: false,
  });
  assert.deepEqual(resolveBoardParam("/boards", undefined), {
    param: undefined,
    stripSearchBoard: false,
  });
});

test("resolveBoardParam asks for no strip when a keyed path has no search key", () => {
  assert.deepEqual(resolveBoardParam("/boards/ACME", undefined), {
    param: "ACME",
    stripSearchBoard: false,
  });
});

test("boardSwitchTarget gives a keyed page the board in its path without its id", () => {
  assert.deepEqual(boardSwitchTarget("inbox", ACME), {
    href: "/boards/ACME/inbox",
  });
  assert.deepEqual(boardSwitchTarget("board", LOCAL), {
    href: "/boards/LOCAL",
  });
});

test("boardSwitchTarget sets the board search parameter of any other page and keeps the rest", () => {
  const target = boardSwitchTarget("tickets", ACME);
  assert.ok("search" in target);
  assert.equal(target.to, ".");
  assert.deepEqual(target.search({ dialog: "new", board: "OLD" }), {
    dialog: "new",
    board: ACME,
  });
  const toLocal = boardSwitchTarget("boards", LOCAL);
  assert.ok("search" in toLocal);
  assert.deepEqual(toLocal.search({ dialog: "new", board: ACME }), {
    dialog: "new",
    board: undefined,
  });
});

test("isArchivedSettingsPath is true only for the settings page of an archived listed board", () => {
  assert.equal(isArchivedSettingsPath("/boards/OLD/settings", boards), true);
  assert.equal(isArchivedSettingsPath("/boards/ACME/settings", boards), false);
  assert.equal(isArchivedSettingsPath("/boards/OLD", boards), false);
  assert.equal(isArchivedSettingsPath("/boards/OLD/inbox", boards), false);
  assert.equal(isArchivedSettingsPath("/boards/GONE/settings", boards), false);
  assert.equal(
    isArchivedSettingsPath("/boards/OLD/settings", undefined),
    false,
  );
  assert.equal(isArchivedSettingsPath("/tickets", boards), false);
});
