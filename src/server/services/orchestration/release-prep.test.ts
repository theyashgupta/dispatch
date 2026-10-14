import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test, { after } from "node:test";
import { parseBoardKey } from "../../../shared/board-key.js";
import type { BoardKey } from "../../../shared/types.js";
import { isolateEnv } from "../../test-support/fixtures.js";
import { ConflictError } from "../domain/errors.js";

const env = isolateEnv();
const { store } = await import("../../store/board.store.js");
const { gitOutput, pushToMain, tempRepoWithWorkspace } =
  await import("../../test-support/git-fixtures.js");
const { setOrchestrationConfig } = await import("../infra/config-holder.js");
const { prepareRelease } = await import("./release-prep.js");

const ONE = parseBoardKey("ONE") as BoardKey;
const LCL = parseBoardKey("LCL") as BoardKey;
const FST = parseBoardKey("FST") as BoardKey;
const DON = parseBoardKey("DON") as BoardKey;
const ORG = parseBoardKey("ORG") as BoardKey;
const PAR = parseBoardKey("PAR") as BoardKey;

const roots: string[] = [];

/** A repository with a `package.json` of `version` committed on main and no origin remote. */
async function localRepo(version: string): Promise<string> {
  const { root, repo } = await tempRepoWithWorkspace();
  roots.push(root);
  fs.writeFileSync(
    path.join(repo, "package.json"),
    `${JSON.stringify({ name: "app", version })}\n`,
  );
  await gitOutput(repo, "add", ".");
  await gitOutput(
    repo,
    "-c",
    "user.name=t",
    "-c",
    "user.email=t@example.com",
    "commit",
    "-qm",
    "package",
  );
  return repo;
}

/** A repository with a bare origin; `package.json` of `version` is pushed to it when `pushPackage` is set, else only committed locally. */
async function originRepo(
  version: string,
  pushPackage: boolean,
): Promise<{ repo: string; bare: string }> {
  const { root, repo } = await tempRepoWithWorkspace();
  roots.push(root);
  const bare = path.join(root, "origin.git");
  await gitOutput(root, "init", "-q", "--bare", "-b", "main", bare);
  await gitOutput(repo, "remote", "add", "origin", bare);
  if (pushPackage) {
    fs.writeFileSync(
      path.join(repo, "package.json"),
      `${JSON.stringify({ name: "app", version })}\n`,
    );
    await gitOutput(repo, "add", ".");
    await gitOutput(
      repo,
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@example.com",
      "commit",
      "-qm",
      "package",
    );
  }
  await gitOutput(repo, "push", "-q", "origin", "main");
  await gitOutput(repo, "fetch", "-q", "origin", "main");
  if (!pushPackage) {
    fs.writeFileSync(
      path.join(repo, "package.json"),
      `${JSON.stringify({ name: "app", version })}\n`,
    );
    await gitOutput(repo, "add", ".");
    await gitOutput(
      repo,
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@example.com",
      "commit",
      "-qm",
      "local package",
    );
  }
  return { repo, bare };
}

const repoOne = await localRepo("1.2.3");
const repoLocal = await localRepo("2.0.0");
const repoFirst = await localRepo("3.0.0");
const repoSecond = await localRepo("4.0.0");
const repoDone = await localRepo("5.0.0");
const noOriginPackage = await originRepo("1.2.3", false);
const parallel = await originRepo("1.2.3", true);

setOrchestrationConfig({ linearApiKey: "" });
await store.load();
for (const [key, repositories] of [
  [ONE, [{ path: repoOne, baseBranch: "main", checkCommand: "" }]],
  [LCL, [{ path: repoLocal, baseBranch: "main", checkCommand: "" }]],
  [
    FST,
    [
      { path: repoFirst, baseBranch: null, checkCommand: "" },
      { path: repoSecond, baseBranch: "main", checkCommand: "" },
    ],
  ],
  [DON, [{ path: repoDone, baseBranch: "main", checkCommand: "" }]],
  [ORG, [{ path: noOriginPackage.repo, baseBranch: "main", checkCommand: "" }]],
  [PAR, [{ path: parallel.repo, baseBranch: "main", checkCommand: "" }]],
] as const) {
  await store.createBoard({
    key,
    name: key,
    workspaceRoot: `/${key.toLowerCase()}/sessions`,
    repositories: [...repositories],
    linearTeamKeys: [],
  });
}
after(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
  env.cleanup();
});

const caller = (boardKey: BoardKey) => ({
  boardKey,
  orchestratorId: `orc-${boardKey.toLowerCase()}`,
});
const INPUT = { bump: "minor" as const, features: ["A feature"], prs: [1] };

void test("two parallel prepareRelease calls with the same bump create one card and reject one with release-exists", async () => {
  const results = await Promise.allSettled([
    prepareRelease(caller(ONE), INPUT),
    prepareRelease(caller(ONE), INPUT),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [
    "fulfilled",
    "rejected",
  ]);
  const won = results.find((r) => r.status === "fulfilled");
  const lost = results.find((r) => r.status === "rejected");
  assert.ok(
    lost?.status === "rejected" && lost.reason instanceof ConflictError,
  );
  assert.equal(lost.reason.code, "release-exists");
  assert.equal(
    lost.reason.details?.cardId,
    won?.status === "fulfilled" ? won.value.cardId : undefined,
  );
  assert.equal(store.listCards(ONE).length, 1);
});

void test("a repository with no origin remote reads package.json at refs/heads/<base>", async () => {
  const out = await prepareRelease(caller(LCL), {
    ...INPUT,
    bump: "patch",
  });
  assert.equal(out.previous, "2.0.0");
  assert.equal(out.version, "2.0.1");
});

void test("an omitted repository picks the first board repository with a base", async () => {
  const out = await prepareRelease(caller(FST), INPUT);
  assert.equal(out.previous, "4.0.0");
  assert.ok(
    store
      .getCard(out.cardId)
      ?.description?.includes(`Repository: ${repoSecond}`),
  );
});

void test("a Done card with the same title does not block a new release card", async () => {
  const first = await prepareRelease(caller(DON), INPUT);
  await store.moveCardManual(first.cardId, "done");
  assert.equal(store.getCard(first.cardId)?.column, "done");
  const second = await prepareRelease(caller(DON), INPUT);
  assert.notEqual(second.cardId, first.cardId);
  assert.equal(second.version, first.version);
  assert.equal(store.getCard(second.cardId)?.column, "todo");
});

void test("an origin base with no package.json answers invalid-version even when the local base has one", async () => {
  await assert.rejects(
    prepareRelease(caller(ORG), { ...INPUT, bump: "patch" }),
    (error: unknown) =>
      error instanceof ConflictError && error.message === "invalid-version",
  );
  assert.equal(store.listCards(ORG).length, 0);
});

void test("two parallel calls after origin moved fetch one at a time and create one card", async () => {
  for (const minor of [4, 6, 8]) {
    await pushToMain(
      parallel.bare,
      {
        "package.json": `${JSON.stringify({ name: "app", version: `1.${minor}.0` })}\n`,
      },
      `release 1.${minor}.0`,
    );
    const results = await Promise.allSettled([
      prepareRelease(caller(PAR), INPUT),
      prepareRelease(caller(PAR), INPUT),
    ]);
    const won = results.filter((r) => r.status === "fulfilled");
    const lost = results.filter((r) => r.status === "rejected");
    assert.equal(won.length, 1);
    assert.equal(won[0]?.value.version, `1.${minor + 1}.0`);
    assert.equal(lost.length, 1);
    assert.ok(lost[0]?.reason instanceof ConflictError);
    assert.equal(lost[0].reason.message, "release-exists");
  }
  assert.deepEqual(
    store
      .listCards(PAR)
      .map((c) => c.title)
      .sort(),
    ["Release v1.5.0", "Release v1.7.0", "Release v1.9.0"],
  );
});
