import test from "node:test";
import assert from "node:assert/strict";
import type { BoardKey, BoardScope } from "../../shared/types.js";
import type { BoardRepository } from "./board-repository.js";

type FirstParam<K extends keyof BoardRepository> = BoardRepository[K] extends (
  first: infer P,
  ...rest: never[]
) => unknown
  ? P
  : never;

type Is<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

const boardScoped = {
  snapshot: true,
  searchCards: true,
  listEvents: true,
  listArchive: true,
  getWorkspaceFolders: true,
  addWorkspaceFolder: true,
  removeWorkspaceFolder: true,
  setLastUsedFolder: true,
  createLocalCard: true,
  createGroupCard: true,
  promoteItem: true,
} satisfies { [K in keyof BoardRepository]?: Is<FirstParam<K>, BoardKey> };

const sweeps = {
  listCards: true,
  sessionsWithTmux: true,
  sessionsDueForCleanup: true,
  archiveDueForDelete: true,
  trackedIssueIds: true,
} satisfies { [K in keyof BoardRepository]?: Is<FirstParam<K>, BoardScope> };

void test("every collection read and create names its board in the first parameter", () => {
  assert.equal(Object.keys(boardScoped).length, 11);
  assert.equal(Object.keys(sweeps).length, 5);
});
