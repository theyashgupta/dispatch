import assert from "node:assert/strict";
import { test } from "node:test";
import type { Board, BoardKey } from "../../../../shared/types.js";
import {
  addRepository,
  changeRepository,
  removeRepository,
} from "./board-form.js";
import {
  applySaved,
  checkBoardSettings,
  isDirty,
  placeRefusal,
  settingsValuesFromBoard,
  toPatch,
  withNewRepositories,
} from "./board-settings.js";

const SECTIONS = ["name", "repositories", "linearTeamKeys"] as const;

function board(patch: Partial<Board> = {}): Board {
  return {
    key: "ACME" as BoardKey,
    name: "Acme",
    workspaceRoot: "/work/acme",
    repositories: [
      { path: "/repo/api", baseBranch: "main", checkCommand: "npm test" },
      { path: "/repo/web", baseBranch: null, checkCommand: "" },
    ],
    linearTeamKeys: ["ACME", "ENG"],
    archived: false,
    ...patch,
  } as unknown as Board;
}

test("settingsValuesFromBoard copies the fields and has no row for a board with no repository", () => {
  const values = settingsValuesFromBoard(board());
  assert.equal(values.name, "Acme");
  assert.equal(values.linearTeamKeys, "ACME, ENG");
  assert.deepEqual(values.repositories[1], {
    path: "/repo/web",
    baseBranch: "",
    checkCommand: "",
  });
  assert.deepEqual(
    settingsValuesFromBoard(board({ repositories: [] })).repositories,
    [],
  );
});

test("a board that was not edited is not dirty and has an empty patch", () => {
  const acme = board();
  const values = settingsValuesFromBoard(acme);
  for (const section of SECTIONS) {
    assert.equal(isDirty(values, acme, section), false);
    assert.deepEqual(toPatch(values, acme, section), {});
  }
});

test("an added row with an empty path is not a change", () => {
  const acme = board();
  const values = addRepository(settingsValuesFromBoard(acme));
  assert.equal(isDirty(values, acme, "repositories"), false);
  assert.deepEqual(toPatch(values, acme, "repositories"), {});
});

test("a changed name sends the trimmed name alone", () => {
  const acme = board();
  const values = { ...settingsValuesFromBoard(acme), name: "  Acme Pay " };
  assert.deepEqual(toPatch(values, acme, "name"), { name: "Acme Pay" });
});

test("a changed base branch sends the repository list with empty-path rows dropped", () => {
  const acme = board();
  const values = addRepository(
    changeRepository(settingsValuesFromBoard(acme), 1, {
      baseBranch: "develop",
    }),
  );
  assert.deepEqual(toPatch(values, acme, "repositories"), {
    repositories: [
      { path: "/repo/api", baseBranch: "main", checkCommand: "npm test" },
      { path: "/repo/web", baseBranch: "develop" },
    ],
  });
});

test("removing the last repository sends an empty list", () => {
  const acme = board({
    repositories: [{ path: "/repo/api", baseBranch: null, checkCommand: "" }],
  });
  const values = removeRepository(settingsValuesFromBoard(acme), 0);
  assert.equal(isDirty(values, acme, "repositories"), true);
  assert.deepEqual(toPatch(values, acme, "repositories"), { repositories: [] });
});

test("changed team keys send the parsed upper-case list", () => {
  const acme = board();
  const values = {
    ...settingsValuesFromBoard(acme),
    linearTeamKeys: "eng, ENG, pay",
  };
  assert.deepEqual(toPatch(values, acme, "linearTeamKeys"), {
    linearTeamKeys: ["ENG", "PAY"],
  });
});

test("the default board sends paths only and never team keys", () => {
  const local = board({
    key: "LOCAL" as BoardKey,
    linearTeamKeys: [],
    repositories: [
      { path: "/repo/api", baseBranch: "main", checkCommand: "make" },
    ],
  });
  const values = {
    ...settingsValuesFromBoard(local),
    linearTeamKeys: "eng",
  };
  assert.equal(isDirty(values, local, "linearTeamKeys"), false);
  assert.equal(isDirty(values, local, "repositories"), false);
  const edited = changeRepository(values, 0, { path: "/repo/other" });
  assert.deepEqual(toPatch(edited, local, "repositories"), {
    repositories: [{ path: "/repo/other" }],
  });
});

test("a section patch holds that section only", () => {
  const acme = board();
  const values = {
    ...settingsValuesFromBoard(acme),
    name: "Pay",
    linearTeamKeys: "PAY",
  };
  assert.deepEqual(toPatch(values, acme, "name"), { name: "Pay" });
  assert.deepEqual(toPatch(values, acme, "linearTeamKeys"), {
    linearTeamKeys: ["PAY"],
  });
  assert.equal(isDirty(values, acme, "repositories"), false);
  assert.equal(isDirty(values, acme, "name"), true);
});

test("checkBoardSettings requires a name", () => {
  const values = settingsValuesFromBoard(board());
  assert.deepEqual(checkBoardSettings(values), {});
  assert.deepEqual(checkBoardSettings({ ...values, name: "  " }), {
    name: "Enter a name.",
  });
});

test("placeRefusal puts a repository refusal on the row of its path", () => {
  const values = settingsValuesFromBoard(board());
  assert.deepEqual(
    placeRefusal(
      {
        error: "This folder does not exist.",
        code: "folder-missing",
        field: "repositories",
        path: "/repo/web",
      },
      values,
      "repositories",
    ),
    { repositoryRows: { 1: "This folder does not exist." } },
  );
});

test("placeRefusal puts any other refusal on the field of the saved section", () => {
  const values = settingsValuesFromBoard(board());
  const refusal = { error: "Enter the path of a git repository.", code: "x" };
  assert.deepEqual(placeRefusal(refusal, values, "repositories"), {
    repositories: "Enter the path of a git repository.",
  });
  assert.deepEqual(placeRefusal(refusal, values, "linearTeamKeys"), {
    linearTeamKeys: "Enter the path of a git repository.",
  });
  assert.deepEqual(
    placeRefusal(
      {
        error: "Gone.",
        code: "folder-missing",
        field: "repositories",
        path: "/nope",
      },
      values,
      "repositories",
    ),
    { repositories: "Gone." },
  );
});

test("applySaved resets one section and keeps the other edits", () => {
  const acme = board();
  const edited = {
    ...settingsValuesFromBoard(acme),
    name: "Draft",
    linearTeamKeys: "PAY",
  };
  const saved = board({ linearTeamKeys: ["PAY"] });
  const next = applySaved(edited, saved, "linearTeamKeys");
  assert.equal(next.linearTeamKeys, "PAY");
  assert.equal(next.name, "Draft");
  assert.equal(isDirty(next, saved, "linearTeamKeys"), false);
});

test("withNewRepositories appends the gained repositories after the unsaved edits", () => {
  const before = board({ repositories: [] });
  const after = board({
    repositories: [
      { path: "/work/acme/acme", baseBranch: "main", checkCommand: "" },
    ],
  });
  const values = addRepository(settingsValuesFromBoard(before));
  const next = withNewRepositories(values, before, after);
  assert.deepEqual(next.repositories, [
    { path: "", baseBranch: "", checkCommand: "" },
    { path: "/work/acme/acme", baseBranch: "main", checkCommand: "" },
  ]);
  assert.equal(
    isDirty(
      withNewRepositories(settingsValuesFromBoard(before), before, after),
      after,
      "repositories",
    ),
    false,
  );
});
