import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { Config } from "../../../shared/types.js";
import { DEFAULT_BOARD_KEY } from "../../../shared/board-key.js";
import { isolateEnv } from "../../test-support/fixtures.js";
import { ConflictError, ValidationError } from "../domain/errors.js";

const env = isolateEnv();
const { store } = await import("../../store/board.store.js");
const { setOrchestrationConfig } = await import("../infra/config-holder.js");
const {
  createGroup,
  recordStartFailure,
  startGroup,
  requireOrchestrationConfig,
} = await import("./group-launch.js");

await store.load();
const CONFIG = { linearApiKey: "k" } as Config;
setOrchestrationConfig(CONFIG);

const repo = path.join(env.root, "repo");
fs.mkdirSync(path.join(repo, ".git"), { recursive: true });
const workspace = { folder: repo, repos: [{ path: repo, base: "main" }] };

after(() => {
  env.cleanup();
});

const local = async (title: string) =>
  (await store.createLocalCard(DEFAULT_BOARD_KEY, title, "")).id;

const groupCount = () =>
  store.listCards(DEFAULT_BOARD_KEY).filter((c) => c.source === "group").length;

void test("createGroup mints the group with its workspace and starts no session", async () => {
  const a = await local("a");
  const b = await local("b");
  const card = await createGroup(DEFAULT_BOARD_KEY, {
    title: "grp",
    memberIds: [a, b],
    workspace,
  });
  assert.equal(card.source, "group");
  assert.equal(store.getCard(a)?.groupId, card.id);
  assert.equal(store.getCard(card.id)?.workspace?.folder, repo);
  assert.equal(store.isStarting(card.id), false);
  assert.equal(store.getCard(card.id)?.tmuxSession, undefined);
});

void test("createGroup refuses an ineligible member with every offending id and mints nothing", async () => {
  const a = await local("c");
  const before = groupCount();
  await assert.rejects(
    createGroup(DEFAULT_BOARD_KEY, {
      title: "grp",
      memberIds: [a, "ghost"],
      workspace,
    }),
    (err: unknown) =>
      err instanceof ConflictError &&
      err.status === 409 &&
      JSON.stringify(err.details) === '{"ineligibleIds":["ghost"]}',
  );
  assert.equal(groupCount(), before);
  assert.equal(store.getCard(a)?.groupId, undefined);
});

void test("createGroup refuses an unknown playbook", async () => {
  const a = await local("d");
  const b = await local("e");
  await assert.rejects(
    createGroup(DEFAULT_BOARD_KEY, {
      title: "grp",
      memberIds: [a, b],
      playbook: "nope",
      workspace,
    }),
    (err: unknown) =>
      err instanceof ValidationError &&
      err.code === "unknown playbook" &&
      err.details?.variant === "playbook",
  );
});

void test("createGroup refuses a missing workspace, a flag-like base and a missing repository", async () => {
  const a = await local("f");
  const b = await local("g");
  const refused = async (
    input: Partial<Parameters<typeof createGroup>[1]>,
    code: string,
  ) =>
    assert.rejects(
      createGroup(DEFAULT_BOARD_KEY, {
        title: "grp",
        memberIds: [a, b],
        ...input,
      }),
      (err: unknown) => err instanceof ValidationError && err.code === code,
    );
  await refused({}, "No workspace selected for this group");
  await refused(
    { workspace: { folder: repo, repos: [{ path: repo, base: "-x" }] } },
    "invalid base branch",
  );
  await refused(
    {
      workspace: {
        folder: repo,
        repos: [{ path: path.join(env.root, "gone"), base: "main" }],
      },
    },
    "Can't start: a selected repo is missing",
  );
  assert.equal(store.getCard(a)?.groupId, undefined);
});

void test("createGroup answers the config error after the member check", async () => {
  const a = await local("h");
  const b = await local("i");
  setOrchestrationConfig(null as unknown as Config);
  try {
    await assert.rejects(
      createGroup(DEFAULT_BOARD_KEY, {
        title: "grp",
        memberIds: [a, "ghost"],
        workspace,
      }),
      ConflictError,
    );
    await assert.rejects(
      createGroup(DEFAULT_BOARD_KEY, {
        title: "grp",
        memberIds: [a, b],
        workspace,
      }),
      (err: unknown) =>
        err instanceof ValidationError &&
        err.code === "orchestration config is not loaded" &&
        err.details?.variant === "config",
    );
    assert.throws(() => requireOrchestrationConfig(), ValidationError);
  } finally {
    setOrchestrationConfig(CONFIG);
  }
});

void test("startGroup starts the session with the direction, config and playbook", () => {
  const calls: unknown[][] = [];
  void startGroup(
    "card-1",
    { extraDirection: "go", playbook: "pb" },
    CONFIG,
    (...args) => {
      calls.push(args);
      return Promise.resolve();
    },
  );
  void startGroup("card-2", {}, CONFIG, (...args) => {
    calls.push(args);
    return Promise.resolve();
  });
  assert.deepEqual(calls, [
    ["card-1", "go", CONFIG, { playbook: "pb" }],
    ["card-2", "", CONFIG, { playbook: undefined }],
  ]);
});

void test("startGroup resolves a failure for a thrown start and for a start error left on the card", async () => {
  const id = await local("start-outcome");
  assert.deepEqual(await startGroup(id, {}, CONFIG, () => Promise.resolve()), {
    ok: true,
  });
  assert.deepEqual(
    await startGroup(id, {}, CONFIG, () => Promise.reject(new Error("boom"))),
    { ok: false, reason: "start failed" },
  );
  assert.deepEqual(
    await startGroup(id, {}, CONFIG, () =>
      store.setStartError(id, {
        step: "creating worktrees",
        stderr: "fatal",
        variant: "generic",
      }),
    ),
    { ok: false, reason: "start failed at creating worktrees" },
  );
});

void test("recordStartFailure writes one start_failed group_state event with the reason", async () => {
  const a = await local("sf-a");
  const b = await local("sf-b");
  const card = await createGroup(DEFAULT_BOARD_KEY, {
    title: "grp",
    memberIds: [a, b],
    workspace,
  });
  await recordStartFailure(card, false, "start failed at workspace");
  const rows = store
    .listOrchestrationEvents(DEFAULT_BOARD_KEY, 0, 500)
    .filter((e) => e.cardId === card.id && e.kind === "group_state");
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].data, {
    state: "start_failed",
    reason: "start failed at workspace",
  });
  assert.equal(rows[0].sessionId, null);
});
