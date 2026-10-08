import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_BOARD_KEY,
  defaultBoardPolicy,
  parseBoardKey,
} from "../../../shared/board-key.js";
import type { Board, BoardKey } from "../../../shared/types.js";
import { boardWorkspace } from "./board-workspace.js";

function board(key: BoardKey, overrides: Partial<Board> = {}): Board {
  return {
    key,
    name: key,
    workspaceRoot: null,
    repositories: [],
    linearTeamKeys: [],
    lastUsedFolder: null,
    policy: defaultBoardPolicy(key),
    orchestrators: [],
    createdAt: "2026-10-06T00:00:00.000Z",
    archived: false,
    ...overrides,
  };
}

void test("the default board reads the config root and the global folders", () => {
  assert.deepEqual(
    boardWorkspace(board(DEFAULT_BOARD_KEY), "/work/sessions", [
      "/work/a",
      "/work/b",
    ]),
    {
      workspaceRoot: "/work/sessions",
      repositories: [
        { path: "/work/a", baseBranch: null, checkCommand: "npm run check" },
        { path: "/work/b", baseBranch: null, checkCommand: "npm run check" },
      ],
    },
  );
});

void test("the default board with no config root has no sessions folder", () => {
  assert.deepEqual(boardWorkspace(board(DEFAULT_BOARD_KEY), undefined, []), {
    workspaceRoot: null,
    repositories: [],
  });
});

void test("another board reads its own row and ignores the config and global folders", () => {
  const acme = parseBoardKey("ACME");
  assert.ok(acme);
  const repositories = [
    { path: "/acme/api", baseBranch: "main", checkCommand: "npm run check" },
    { path: "/acme/web", baseBranch: "develop", checkCommand: "make test" },
  ];
  assert.deepEqual(
    boardWorkspace(
      board(acme, { workspaceRoot: "/acme/sessions", repositories }),
      "/work/sessions",
      ["/work/a"],
    ),
    { workspaceRoot: "/acme/sessions", repositories },
  );
});
