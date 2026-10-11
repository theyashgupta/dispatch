import assert from "node:assert/strict";
import { test } from "node:test";
import type { BoardKey } from "../../../../shared/types.js";
import {
  addRepository,
  changeRepository,
  checkBoardForm,
  EMPTY_FORM,
  EMPTY_REPOSITORY,
  failureText,
  folderPlaceholder,
  parseTeamKeys,
  previewKey,
  refusalErrors,
  refusalFieldError,
  removeRepository,
  rowOfPath,
  takenKeySet,
  toCreateInput,
  visibleErrors,
  type BoardFormContext,
  type BoardFormValues,
} from "./board-form.js";

const boards = [
  { key: "LOCAL" as BoardKey, name: "Dispatch" },
  { key: "PLAT" as BoardKey, name: "Platform" },
];

const create: BoardFormContext = {
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

test("only the name is required", () => {
  assert.deepEqual(
    checkBoardForm(
      values({ key: "", workspaceRoot: "", repositories: [] }),
      create,
    ),
    {},
  );
  assert.deepEqual(checkBoardForm(EMPTY_FORM, create), {
    name: "Enter a name.",
  });
});

test("a blank name gets the name copy", () => {
  assert.equal(
    checkBoardForm(values({ name: "  " }), create).name,
    "Enter a name.",
  );
});

test("an empty or blank key is not checked", () => {
  for (const key of ["", "   "]) {
    assert.equal(checkBoardForm(values({ key }), create).key, undefined);
  }
});

test("a typed key that breaks the rule gets the key rule copy", () => {
  const copy = "Use 2 to 6 capital letters or digits, starting with a letter.";
  for (const key of ["pl", "A", "1AB", "ABCDEFG", "AB-C", "AB C"]) {
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

test("a key that another board has names that board and suggests a free key", () => {
  const errors = checkBoardForm(values({ key: "PLAT" }), create);
  assert.equal(errors.key, "Board Platform uses this key.");
  assert.equal(errors.keySuggestion, "PLAT2");
});

test("a key that a known Linear team has names the team and suggests a free key", () => {
  const errors = checkBoardForm(values({ key: "ENG" }), create);
  assert.equal(errors.key, "Linear team ENG uses this key.");
  assert.equal(errors.keySuggestion, "ENG2");
});

test("a free key carries no suggestion", () => {
  assert.equal(
    checkBoardForm(values({ key: "ACME" }), create).keySuggestion,
    undefined,
  );
});

test("the folder and the repositories are optional, and empty rows are no error", () => {
  const blank = [{ path: " ", baseBranch: "main", checkCommand: "" }];
  assert.deepEqual(
    checkBoardForm(
      values({ workspaceRoot: "  ", repositories: blank }),
      create,
    ),
    {},
  );
  assert.deepEqual(checkBoardForm(values({ repositories: [] }), create), {});
});

test("takenKeySet joins board keys and Linear team keys", () => {
  assert.deepEqual([...takenKeySet(boards, ["ENG"])].sort(), [
    "ENG",
    "LOCAL",
    "PLAT",
  ]);
});

test("previewKey derives a free key, and is null for a blank name or no free key", () => {
  const taken = takenKeySet(boards, ["ENG"]);
  assert.equal(previewKey("Payments", taken), "PAYMEN");
  assert.equal(previewKey("Platform", taken), "PLATFO");
  assert.equal(previewKey("Plat", taken), "PLAT2");
  assert.equal(previewKey("Local", taken), "LOCAL2");
  assert.equal(previewKey("  ", taken), null);
  assert.equal(previewKey("Payments", new Set(["PAYMEN"])), "PAYME2");
});

test("previewKey is null when every candidate is taken", () => {
  const all = new Set<string>(["AB"]);
  for (let d = 2; d <= 9; d++) all.add(`AB${d}`);
  for (let n = 10; n <= 99; n++) all.add(`AB${n}`);
  assert.equal(previewKey("ab", all), null);
});

test("folderPlaceholder joins the root and the key, and is empty without a root or a key", () => {
  assert.equal(folderPlaceholder("/work", "ACME"), "/work/ACME");
  assert.equal(folderPlaceholder("/work/", "ACME"), "/work/ACME");
  assert.equal(folderPlaceholder(null, "ACME"), "");
  assert.equal(folderPlaceholder(undefined, "ACME"), "");
  assert.equal(folderPlaceholder("", "ACME"), "");
  assert.equal(folderPlaceholder("/work", ""), "");
});

test("parseTeamKeys upper-cases, trims, drops empties and repeats", () => {
  assert.deepEqual(parseTeamKeys("acme, eng"), ["ACME", "ENG"]);
  assert.deepEqual(parseTeamKeys(" a1 ,, a1 ,"), ["A1"]);
  assert.deepEqual(parseTeamKeys(""), []);
});

test("toCreateInput sends the name alone for a name-only form", () => {
  assert.deepEqual(toCreateInput({ ...EMPTY_FORM, name: " Acme " }), {
    name: "Acme",
  });
});

test("toCreateInput sends each optional field only when filled", () => {
  const input = toCreateInput(
    values({
      key: " ACME ",
      name: " Acme ",
      workspaceRoot: " /work/acme ",
      repositories: [
        { path: " /r/a ", baseBranch: " main ", checkCommand: " make " },
        { path: "/r/b", baseBranch: "", checkCommand: "" },
        { path: "  ", baseBranch: "x", checkCommand: "y" },
      ],
      linearTeamKeys: "acme, eng",
    }),
  );
  assert.deepEqual(input, {
    name: "Acme",
    key: "ACME",
    workspaceRoot: "/work/acme",
    repositories: [
      { path: "/r/a", baseBranch: "main", checkCommand: "make" },
      { path: "/r/b", baseBranch: null },
    ],
    linearTeamKeys: ["ACME", "ENG"],
  });
});

test("toCreateInput leaves out blank fields and rows with an empty path", () => {
  const input = toCreateInput(
    values({
      key: " ",
      workspaceRoot: " ",
      repositories: [EMPTY_REPOSITORY],
      linearTeamKeys: " , ",
    }),
  );
  assert.deepEqual(input, { name: "Acme" });
});

test("refusalFieldError maps duplicate-key to the key with the suggestion", () => {
  assert.deepEqual(
    refusalFieldError({
      error: "Board Acme uses this key.",
      code: "duplicate-key",
      suggestion: "ACME2",
    }),
    {
      field: "key",
      message: "Board Acme uses this key.",
      suggestion: "ACME2",
    },
  );
  assert.deepEqual(
    refusalFieldError({
      error: "Board Acme uses this key.",
      code: "duplicate-key",
    }),
    { field: "key", message: "Board Acme uses this key." },
  );
});

test("refusalFieldError maps folder-missing to the folder or to a repository row", () => {
  const copy = "This folder does not exist.";
  assert.deepEqual(refusalFieldError({ error: copy, code: "folder-missing" }), {
    field: "workspaceRoot",
    message: copy,
  });
  assert.deepEqual(
    refusalFieldError({
      error: copy,
      code: "folder-missing",
      field: "workspaceRoot",
    }),
    { field: "workspaceRoot", message: copy },
  );
  assert.deepEqual(
    refusalFieldError({
      error: copy,
      code: "folder-missing",
      field: "repositories",
      path: "/nope",
    }),
    { field: "repositories", message: copy, path: "/nope" },
  );
});

test("refusalFieldError maps missing-name and invalid-name to the name and anything else to the form", () => {
  assert.deepEqual(
    refusalFieldError({ error: "Enter a name.", code: "missing-name" }),
    { field: "name", message: "Enter a name." },
  );
  assert.deepEqual(
    refusalFieldError({ error: "One line.", code: "invalid-name" }),
    { field: "name", message: "One line." },
  );
  for (const code of ["invalid-key", "no-workspaces-root", "unknown"]) {
    assert.deepEqual(refusalFieldError({ error: "Nope.", code }), {
      field: "form",
      message: "Nope.",
    });
  }
});

test("refusalErrors places each refusal on its field", () => {
  const form = values({
    repositories: [
      { path: "/ok", baseBranch: "", checkCommand: "" },
      { path: " /nope ", baseBranch: "", checkCommand: "" },
    ],
  });
  assert.deepEqual(
    refusalErrors(
      { error: "Dup.", code: "duplicate-key", suggestion: "ACME2" },
      form,
    ),
    { errors: { key: "Dup.", keySuggestion: "ACME2" }, form: null },
  );
  assert.deepEqual(
    refusalErrors({ error: "Name.", code: "missing-name" }, form),
    {
      errors: { name: "Name." },
      form: null,
    },
  );
  assert.deepEqual(
    refusalErrors({ error: "Gone.", code: "folder-missing" }, form),
    { errors: { workspaceRoot: "Gone." }, form: null },
  );
  assert.deepEqual(
    refusalErrors(
      {
        error: "Gone.",
        code: "folder-missing",
        field: "repositories",
        path: "/nope",
      },
      form,
    ),
    { errors: { repositoryRows: { 1: "Gone." } }, form: null },
  );
  assert.deepEqual(
    refusalErrors(
      {
        error: "Gone.",
        code: "folder-missing",
        field: "repositories",
        path: "/other",
      },
      form,
    ),
    { errors: { repositories: "Gone." }, form: null },
  );
  assert.deepEqual(
    refusalErrors({ error: "Set it.", code: "no-workspaces-root" }, form),
    {
      errors: {},
      form: "Set it.",
    },
  );
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

test("add, change and remove edit the repository rows without changing the input", () => {
  const form = values({
    repositories: [
      { path: "/a", baseBranch: "main", checkCommand: "" },
      { path: "/b", baseBranch: "", checkCommand: "" },
    ],
  });
  const added = addRepository(form);
  assert.equal(added.repositories.length, 3);
  assert.equal(added.repositories[2], EMPTY_REPOSITORY);
  assert.equal(form.repositories.length, 2);
  const changed = changeRepository(form, 0, { baseBranch: "develop" });
  assert.equal(changed.repositories[0]?.baseBranch, "develop");
  assert.equal(changed.repositories[0]?.path, "/a");
  assert.deepEqual(removeRepository(form, 0).repositories, [
    form.repositories[1],
  ]);
});

test("rowOfPath finds the row by trimmed path and gives -1 for no row", () => {
  const rows = [
    { path: "/a", baseBranch: "", checkCommand: "" },
    { path: " /b ", baseBranch: "", checkCommand: "" },
  ];
  assert.equal(rowOfPath(rows, "/b"), 1);
  assert.equal(rowOfPath(rows, "/c"), -1);
  assert.equal(rowOfPath(rows, undefined), -1);
});

test("visibleErrors shows refusals always and checked errors by state", () => {
  const found = {
    key: "Bad key.",
    keySuggestion: "ACME2",
    name: "Enter a name.",
  };
  const refused = { workspaceRoot: "Gone." };
  const idle = { attempted: false, keyTouched: false, hidden: false };
  assert.deepEqual(visibleErrors(found, {}, idle), {});
  assert.deepEqual(visibleErrors(found, refused, idle), refused);
  assert.deepEqual(visibleErrors(found, {}, { ...idle, keyTouched: true }), {
    key: "Bad key.",
    keySuggestion: "ACME2",
  });
  assert.deepEqual(
    visibleErrors({ name: "Enter a name." }, {}, { ...idle, keyTouched: true }),
    {},
  );
  assert.deepEqual(
    visibleErrors(found, {}, { ...idle, attempted: true }),
    found,
  );
  assert.deepEqual(
    visibleErrors(found, refused, {
      attempted: true,
      keyTouched: true,
      hidden: true,
    }),
    refused,
  );
});
