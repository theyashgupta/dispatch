import assert from "node:assert/strict";
import { test } from "node:test";
import type { Board, BoardKey } from "../../../../shared/types.js";
import {
  checkBoardForm,
  EMPTY_FORM,
  failureText,
  formValuesFromBoard,
  parseTeamKeys,
  toCreateInput,
  toUpdateInput,
  type BoardFormContext,
  type BoardFormValues,
} from "./board-form.js";

const boards = [
  { key: "LOCAL" as BoardKey, name: "Dispatch" },
  { key: "PLAT" as BoardKey, name: "Platform" },
];

const create: BoardFormContext = {
  mode: "create",
  isDefault: false,
  boards,
  knownLinearTeamKeys: ["ENG"],
};

function values(patch: Partial<BoardFormValues> = {}): BoardFormValues {
  return {
    key: "ACME",
    name: "Acme",
    workspaceRoot: "/work/acme",
    repositories: [{ path: "/repo/acme", baseBranch: "", checkCommand: "" }],
    linearTeamKeys: "",
    ...patch,
  };
}

test("a valid create form has no errors", () => {
  assert.deepEqual(checkBoardForm(values(), create), {});
});

test("a key that breaks the rule gets the key rule copy", () => {
  const copy = "Use 2 to 6 capital letters or digits, starting with a letter.";
  for (const key of ["", "pl", "A", "1AB", "ABCDEFG", "AB-C", "AB C"]) {
    assert.equal(checkBoardForm(values({ key }), create).key, copy, key);
  }
});

test("LOCAL and GROUP are reserved", () => {
  for (const key of ["LOCAL", "GROUP"]) {
    assert.equal(
      checkBoardForm(values({ key }), create).key,
      "LOCAL and GROUP are reserved.",
    );
  }
});

test("a key that another board has names that board", () => {
  assert.equal(
    checkBoardForm(values({ key: "PLAT" }), create).key,
    "Board Platform uses this key.",
  );
});

test("a key that a known Linear team has names the team", () => {
  assert.equal(
    checkBoardForm(values({ key: "ENG" }), create).key,
    "Linear team ENG uses this key.",
  );
});

test("a blank name gets the name copy", () => {
  assert.equal(
    checkBoardForm(values({ name: "  " }), create).name,
    "Enter a name.",
  );
});

test("a blank sessions folder gets the sessions folder copy in create mode only", () => {
  assert.equal(
    checkBoardForm(values({ workspaceRoot: "  " }), create).workspaceRoot,
    "Enter the sessions folder.",
  );
  assert.equal(
    checkBoardForm(values({ workspaceRoot: "" }), { ...create, mode: "edit" })
      .workspaceRoot,
    undefined,
  );
});

test("no repository path gets the repository copy", () => {
  const empty = [{ path: " ", baseBranch: "main", checkCommand: "" }];
  assert.equal(
    checkBoardForm(values({ repositories: empty }), create).repositories,
    "Add at least one repository.",
  );
  assert.equal(
    checkBoardForm(values({ repositories: [] }), create).repositories,
    "Add at least one repository.",
  );
});

test("edit mode skips the key checks", () => {
  const edit: BoardFormContext = { ...create, mode: "edit" };
  assert.deepEqual(checkBoardForm(values({ key: "PLAT" }), edit), {});
  assert.deepEqual(checkBoardForm(values({ key: "x" }), edit), {});
});

test("the default board skips the repository check", () => {
  const edit: BoardFormContext = { ...create, mode: "edit", isDefault: true };
  assert.deepEqual(checkBoardForm(values({ repositories: [] }), edit), {});
  assert.equal(
    checkBoardForm(values({ name: "", repositories: [] }), edit).name,
    "Enter a name.",
  );
});

test("parseTeamKeys upper-cases, trims, drops empties and repeats", () => {
  assert.deepEqual(parseTeamKeys("acme, eng"), ["ACME", "ENG"]);
  assert.deepEqual(parseTeamKeys(" a1 ,, a1 ,"), ["A1"]);
  assert.deepEqual(parseTeamKeys(""), []);
});

test("toCreateInput trims and drops empty rows and empty fields", () => {
  const input = toCreateInput(
    values({
      key: " ACME ",
      name: " Acme ",
      repositories: [
        { path: " /r/a ", baseBranch: " main ", checkCommand: " make " },
        { path: "/r/b", baseBranch: "", checkCommand: "" },
        { path: "  ", baseBranch: "x", checkCommand: "y" },
      ],
      linearTeamKeys: "acme, eng",
    }),
  );
  assert.deepEqual(input, {
    key: "ACME",
    name: "Acme",
    workspaceRoot: "/work/acme",
    repositories: [
      { path: "/r/a", baseBranch: "main", checkCommand: "make" },
      { path: "/r/b", baseBranch: null },
    ],
    linearTeamKeys: ["ACME", "ENG"],
  });
});

test("toUpdateInput sends the default board paths only and no team keys", () => {
  const input = toUpdateInput(
    values({
      repositories: [
        { path: "/r/a", baseBranch: "main", checkCommand: "make" },
      ],
      linearTeamKeys: "eng",
    }),
    "LOCAL",
  );
  assert.deepEqual(input, {
    name: "Acme",
    workspaceRoot: "/work/acme",
    repositories: [{ path: "/r/a" }],
  });
});

test("toUpdateInput sends the team keys of another board", () => {
  const input = toUpdateInput(values({ linearTeamKeys: "eng" }), "ACME");
  assert.deepEqual(input.linearTeamKeys, ["ENG"]);
  assert.deepEqual(input.repositories, [
    { path: "/repo/acme", baseBranch: null },
  ]);
});

test("formValuesFromBoard fills the form and keeps one empty row for no repository", () => {
  const board = {
    key: "ACME" as BoardKey,
    name: "Acme",
    workspaceRoot: null,
    repositories: [],
    linearTeamKeys: ["ACME", "ENG"],
  } as unknown as Board;
  const form = formValuesFromBoard(board);
  assert.equal(form.workspaceRoot, "");
  assert.equal(form.repositories.length, 1);
  assert.equal(form.linearTeamKeys, "ACME, ENG");
  assert.deepEqual(EMPTY_FORM.repositories[0], form.repositories[0]);
});

test("formValuesFromBoard copies each repository and blanks a missing base branch", () => {
  const board = {
    key: "ACME" as BoardKey,
    name: "Acme",
    workspaceRoot: "/work/acme",
    repositories: [
      { path: "/repo/api", baseBranch: "main", checkCommand: "npm test" },
      { path: "/repo/web", baseBranch: null, checkCommand: "" },
    ],
    linearTeamKeys: [],
  } as unknown as Board;
  const form = formValuesFromBoard(board);
  assert.equal(form.workspaceRoot, "/work/acme");
  assert.deepEqual(form.repositories, [
    { path: "/repo/api", baseBranch: "main", checkCommand: "npm test" },
    { path: "/repo/web", baseBranch: "", checkCommand: "" },
  ]);
  assert.equal(form.linearTeamKeys, "");
});

test("failureText ends with one period", () => {
  assert.equal(
    failureText("Create board failed", "the key is in use"),
    "Create board failed: the key is in use.",
  );
  assert.equal(
    failureText("Save failed", "This folder does not exist."),
    "Save failed: This folder does not exist.",
  );
});
