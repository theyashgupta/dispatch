import test from "node:test";
import assert from "node:assert/strict";
import { BoardValidationError } from "../services/domain/errors.js";
import {
  createBoardBodySchema,
  isGitRefName,
  parseBoardKeyParam,
  parseBoardParam,
  patchBoardBodySchema,
} from "./boards-schemas.js";

function issue(
  schema: {
    safeParse(v: unknown): {
      success: boolean;
      error?: { issues: { message: string }[] };
    };
  },
  body: unknown,
): string | undefined {
  const result = schema.safeParse(body);
  return result.success ? undefined : result.error?.issues[0]?.message;
}

const valid = {
  key: "ACME",
  name: "Acme",
  workspaceRoot: "/srv/sessions",
  repositories: [{ path: "/srv/api" }],
};

test("parseBoardParam reads an absent board, a key and ignores other parameters", () => {
  assert.equal(parseBoardParam({}), undefined);
  assert.equal(parseBoardParam({ other: "x" }), undefined);
  assert.equal(parseBoardParam({ board: "ACME", doneLimit: "5" }), "ACME");
});

test("parseBoardParam and parseBoardKeyParam throw invalid-board for a malformed key", () => {
  for (const board of ["acme", "A", "TOOLONG1", "", ["ACME", "OPS"], 5]) {
    for (const run of [
      () => parseBoardParam({ board }),
      () => parseBoardKeyParam(board),
    ]) {
      assert.throws(
        run,
        (err) =>
          err instanceof BoardValidationError &&
          err.status === 400 &&
          err.code === "invalid-board",
        JSON.stringify(board),
      );
    }
  }
});

test("isGitRefName follows the ref rules a base branch needs", () => {
  for (const ok of ["main", "release/1.0", "feat/a-b_c", "v1.2.3", "a@b"]) {
    assert.equal(isGitRefName(ok), true, ok);
  }
  for (const bad of [
    "",
    "@",
    "-x",
    "a..b",
    "a b",
    "a~1",
    "a^",
    "a:b",
    "a?b",
    "a*b",
    "a[b",
    "a\\b",
    "a@{b",
    "/a",
    "a/",
    "a//b",
    "a/.b",
    "a.lock",
    "a/b.lock/c",
    "a.",
    "a\nb",
  ]) {
    assert.equal(isGitRefName(bad), false, JSON.stringify(bad));
  }
});

test("the create body normalises paths, fills the defaults and drops a repeated repository", () => {
  const parsed = createBoardBodySchema.parse({
    ...valid,
    workspaceRoot: "/srv/sessions/",
    repositories: [
      { path: "/srv/api/" },
      { path: "/srv/api", baseBranch: "main" },
    ],
    linearTeamKeys: ["AC", "AC"],
  }) as Record<string, unknown>;
  assert.equal(parsed.workspaceRoot, "/srv/sessions");
  assert.deepEqual(parsed.repositories, [
    { path: "/srv/api", baseBranch: "main", checkCommand: "npm run check" },
  ]);
  assert.deepEqual(parsed.linearTeamKeys, ["AC"]);
  assert.deepEqual(
    (createBoardBodySchema.parse(valid) as { linearTeamKeys: string[] })
      .linearTeamKeys,
    [],
  );
});

test("the create body names the variant of the first failing field", () => {
  const cases: [Record<string, unknown>, string][] = [
    [{ key: undefined }, "invalid-key"],
    [{ name: undefined }, "missing-name"],
    [{ workspaceRoot: "rel" }, "folder-missing"],
    [{ workspaceRoot: "/a/../b" }, "folder-missing"],
    [{ workspaceRoot: "/a/./b" }, "folder-missing"],
    [{ workspaceRoot: "/a//b" }, "folder-missing"],
    [{ workspaceRoot: "/a\u0000b" }, "folder-missing"],
    [{ repositories: undefined }, "no-repositories"],
    [{ repositories: [{ path: "rel" }] }, "folder-missing"],
    [
      { repositories: [{ path: "/a", baseBranch: "a b" }] },
      "invalid-base-branch",
    ],
    [
      { repositories: [{ path: "/a", checkCommand: " " }] },
      "invalid-check-command",
    ],
    [{ repositories: ["x"] }, "invalid-repository"],
    [{ linearTeamKeys: ["eng"] }, "invalid-linear-team-keys"],
  ];
  for (const [over, message] of cases) {
    assert.equal(
      issue(createBoardBodySchema, { ...valid, ...over }),
      message,
      message,
    );
  }
  assert.equal(issue(createBoardBodySchema, null), "invalid-key");
});

test("the create body refuses the root folder, a newline or carriage return, and a reserved team key", () => {
  const cases: [Record<string, unknown>, string][] = [
    [{ workspaceRoot: "/" }, "folder-missing"],
    [{ workspaceRoot: "//" }, "folder-missing"],
    [{ workspaceRoot: "/srv/a\nb" }, "folder-missing"],
    [{ workspaceRoot: "/srv/a\rb" }, "folder-missing"],
    [{ repositories: [{ path: "/" }] }, "folder-missing"],
    [{ repositories: [{ path: "/srv/a\nb" }] }, "folder-missing"],
    [
      { repositories: [{ path: "/a", checkCommand: "make\nrm -rf x" }] },
      "invalid-check-command",
    ],
    [
      { repositories: [{ path: "/a", checkCommand: "make\rx" }] },
      "invalid-check-command",
    ],
    [{ linearTeamKeys: ["LOCAL"] }, "reserved-key"],
    [{ linearTeamKeys: ["AC", "GROUP"] }, "reserved-key"],
  ];
  for (const [over, message] of cases) {
    assert.equal(
      issue(createBoardBodySchema, { ...valid, ...over }),
      message,
      JSON.stringify(over),
    );
  }
  assert.equal(
    issue(patchBoardBodySchema, { workspaceRoot: "/" }),
    "folder-missing",
  );
});

test("the patch body takes the four fields and refuses any other", () => {
  assert.deepEqual(patchBoardBodySchema.parse({}), {});
  assert.deepEqual(
    patchBoardBodySchema.parse({ name: "New", linearTeamKeys: ["AB"] }),
    {
      name: "New",
      linearTeamKeys: ["AB"],
    },
  );
  for (const field of ["key", "policy", "archived", "lastUsedFolder"]) {
    assert.equal(
      issue(patchBoardBodySchema, { [field]: "x" }),
      "unsupported-field",
      field,
    );
  }
  assert.equal(
    issue(patchBoardBodySchema, { workspaceRoot: null }),
    "folder-missing",
  );
});

test("the length limits hold at the boundary and an explicit null base branch reads as none", () => {
  const withRepo = (repo: Record<string, unknown>) => ({
    ...valid,
    repositories: [{ path: "/a", ...repo }],
  });
  const cases: [Record<string, unknown>, string | undefined][] = [
    [{ baseBranch: "b".repeat(255) }, undefined],
    [{ baseBranch: "b".repeat(256) }, "invalid-base-branch"],
    [{ checkCommand: "c".repeat(500) }, undefined],
    [{ checkCommand: "c".repeat(501) }, "invalid-check-command"],
    [{ checkCommand: "\t" }, "invalid-check-command"],
  ];
  for (const [repo, message] of cases) {
    assert.equal(
      issue(createBoardBodySchema, withRepo(repo)),
      message,
      JSON.stringify(repo).slice(0, 40),
    );
  }
  assert.equal(
    issue(createBoardBodySchema, {
      ...valid,
      linearTeamKeys: ["A" + "B".repeat(9)],
    }),
    undefined,
  );
  assert.equal(
    issue(createBoardBodySchema, {
      ...valid,
      linearTeamKeys: ["A" + "B".repeat(10)],
    }),
    "invalid-linear-team-keys",
  );
  assert.equal(
    issue(patchBoardBodySchema, { linearTeamKeys: ["A" + "B".repeat(10)] }),
    "invalid-linear-team-keys",
  );
  const parsed = createBoardBodySchema.parse(
    withRepo({ baseBranch: null }),
  ) as { repositories: { baseBranch: string | null }[] };
  assert.equal(parsed.repositories[0]?.baseBranch, null);
});
