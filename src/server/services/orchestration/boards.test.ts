import test, { after, mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { isolateEnv } from "../../test-support/fixtures.js";
import { issue } from "../../test-support/fake-source.js";
import { parseBoardKey } from "../../../shared/board-key.js";
import type { BoardKey, Card, LoopProgress } from "../../../shared/types.js";

const env = isolateEnv();
const { store } = await import("../../store/board.store.js");
const { setOrchestrationConfig } = await import("../infra/config-holder.js");
const { CONFIG_PATH } = await import("../infra/paths.js");
const { BoardConflictError, BoardValidationError } =
  await import("../domain/errors.js");
const {
  archiveBoard,
  boardCounts,
  createBoard,
  getBoard,
  isLiveSessionCard,
  listBoards,
  restoreBoard,
  runningLoops,
  updateBoard,
} = await import("./boards.js");

const sessions = path.join(env.root, "sessions");
const repoA = path.join(env.root, "repos", "a");
const repoB = path.join(env.root, "repos", "b");
fs.mkdirSync(sessions, { recursive: true });
for (const dir of [repoA, repoB]) {
  fs.mkdirSync(path.join(dir, ".git"), { recursive: true });
}
setOrchestrationConfig({ linearApiKey: "", workspaceRoot: sessions });
await store.load();
await store.applyIssues(
  [issue("ops-9", { identifier: "OPS-9" })],
  new Date().toISOString(),
  { source: "linear" },
);
after(() => env.cleanup());

function key(value: string): BoardKey {
  const parsed = parseBoardKey(value);
  assert.ok(parsed, value);
  return parsed;
}

function input(over: Record<string, unknown> = {}) {
  return {
    key: "ACME",
    name: "Acme",
    workspaceRoot: sessions,
    repositories: [{ path: repoA, baseBranch: null, checkCommand: "x" }],
    linearTeamKeys: [],
    ...over,
  };
}

function refusal(
  status: number,
  code: string,
  error: string,
  details: Record<string, unknown> = {},
) {
  return (err: unknown): boolean => {
    assert.ok(
      err instanceof BoardValidationError || err instanceof BoardConflictError,
    );
    assert.equal(err.status, status);
    assert.equal(err.code, error);
    assert.deepEqual(err.details, { code, ...details });
    return true;
  };
}

function countingReader(keys: string[] | null) {
  const reader = () => {
    reader.calls += 1;
    return Promise.resolve(keys);
  };
  reader.calls = 0;
  return reader;
}

test("createBoard runs the key, name, folder and repository checks in form order", async () => {
  const reader = countingReader([]);
  const cases: [Record<string, unknown>, string, string][] = [
    [
      { key: "ab" },
      "invalid-key",
      "Use 2 to 6 capital letters or digits, starting with a letter.",
    ],
    [{ key: "GROUP" }, "reserved-key", "LOCAL and GROUP are reserved."],
    [{ name: "  " }, "missing-name", "Enter a name."],
    [
      { workspaceRoot: path.join(env.root, "gone") },
      "folder-missing",
      "This folder does not exist.",
    ],
    [
      { workspaceRoot: path.join(sessions, "x.txt") },
      "folder-missing",
      "This folder does not exist.",
    ],
    [{ repositories: [] }, "no-repositories", "Add at least one repository."],
    [
      {
        repositories: [{ path: sessions, baseBranch: null, checkCommand: "x" }],
      },
      "folder-missing",
      "This folder does not exist.",
    ],
    [
      { key: "bad", name: "", workspaceRoot: "/gone", repositories: [] },
      "invalid-key",
      "Use 2 to 6 capital letters or digits, starting with a letter.",
    ],
    [
      { name: "", workspaceRoot: "/gone", repositories: [] },
      "missing-name",
      "Enter a name.",
    ],
    [
      { workspaceRoot: "/gone", repositories: [] },
      "folder-missing",
      "This folder does not exist.",
    ],
  ];
  fs.writeFileSync(path.join(sessions, "x.txt"), "");
  for (const [over, code, copy] of cases) {
    const before = store.listBoards().length;
    await assert.rejects(
      createBoard(input(over), reader),
      (err) =>
        err instanceof BoardValidationError &&
        err.status === 400 &&
        err.code === copy &&
        (err.details as { code: string }).code === code,
      code,
    );
    assert.equal(store.listBoards().length, before);
  }
  assert.equal(reader.calls, 0, "the Linear read waits for the local checks");
});

test("createBoard skips the Linear team check when the read answers null, and checks it otherwise", async () => {
  await assert.rejects(
    createBoard(input({ key: "PLAT" }), countingReader(["PLAT", "ENG"])),
    refusal(400, "linear-team-key", "Linear team PLAT uses this key."),
  );
  assert.equal(store.getBoard(key("PLAT")), undefined);

  const skipped = countingReader(null);
  const board = await createBoard(
    input({ key: "PLAT", name: "Plat" }),
    skipped,
  );
  assert.equal(skipped.calls, 1);
  assert.equal(board.key, "PLAT");
  assert.equal(board.policy.supervisor, "on");
});

test("createBoard refuses a duplicate key without a Linear read and maps a store key-in-use refusal", async () => {
  const reader = countingReader([]);
  await assert.rejects(
    createBoard(input({ key: "PLAT", name: "Second" }), reader),
    refusal(400, "duplicate-key", "Board Plat uses this key."),
  );
  assert.equal(reader.calls, 0);
  await assert.rejects(
    createBoard(input({ key: "OPS", name: "Ops" }), reader),
    refusal(400, "linear-team-key", "Linear team OPS uses this key."),
  );
});

test("createBoard stores the trimmed name and a copy of the repositories", async () => {
  const repositories = [
    { path: repoB, baseBranch: "main", checkCommand: "make" },
  ];
  const board = await createBoard(
    input({ key: "COPY", name: "  Copy  ", repositories }),
    countingReader([]),
  );
  assert.equal(board.name, "Copy");
  repositories[0].path = "/changed";
  assert.equal(store.getBoard(key("COPY"))?.repositories[0].path, repoB);
});

test("listBoards joins the Linear card prefixes and the team keys, and skips a null read", async () => {
  const joined = await listBoards(countingReader(["ENG", "OPS"]));
  assert.deepEqual(joined.knownLinearTeamKeys, ["ENG", "OPS"]);
  const skipped = await listBoards(countingReader(null));
  assert.deepEqual(skipped.knownLinearTeamKeys, ["OPS"]);
  assert.deepEqual(
    skipped.boards.map((b) => b.key),
    ["LOCAL", "PLAT", "COPY"],
  );
});

test("a returned board is a copy, so a caller cannot change the store", async () => {
  const board = getBoard(key("PLAT"));
  board.name = "Changed";
  board.repositories.length = 0;
  board.policy.concurrencyCap = 99;
  const fresh = getBoard(key("PLAT"));
  assert.equal(fresh.name, "Plat");
  assert.equal(fresh.repositories.length, 1);
  assert.equal(fresh.policy.concurrencyCap, 3);
  const listed = (await listBoards(countingReader(null))).boards[1];
  listed.name = "Changed";
  assert.equal(store.getBoard(key("PLAT"))?.name, "Plat");
});

test("updateBoard checks before it writes, and the default board writes Config and the workspace folders", async () => {
  const other = path.join(env.root, "other");
  fs.mkdirSync(other);
  const configBefore = fs.readFileSync(CONFIG_PATH, "utf8");
  await assert.rejects(
    updateBoard(key("LOCAL"), {
      workspaceRoot: other,
      repositories: [
        {
          path: path.join(env.root, "nope"),
          baseBranch: null,
          checkCommand: "x",
        },
      ],
    }),
    refusal(400, "folder-missing", "This folder does not exist.", {
      field: "repositories",
      path: path.join(env.root, "nope"),
    }),
  );
  assert.equal(fs.readFileSync(CONFIG_PATH, "utf8"), configBefore);

  const local = await updateBoard(key("LOCAL"), {
    workspaceRoot: other,
    repositories: [],
  });
  assert.equal(local.workspaceRoot, other);
  assert.deepEqual(local.repositories, []);
  assert.equal(
    (
      JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")) as {
        workspaceRoot: string;
      }
    ).workspaceRoot,
    other,
  );
  await assert.rejects(
    updateBoard(key("PLAT"), { repositories: [] }),
    refusal(400, "no-repositories", "Add at least one repository."),
  );
  await assert.rejects(
    updateBoard(key("NOPE"), { name: "x" }),
    (err) =>
      err instanceof Error && (err as { status?: number }).status === 404,
  );
});

test("isLiveSessionCard is true only for a session that is neither starting nor lost", () => {
  const card = (over: Partial<Card>): Card => ({ ...over }) as Card;
  assert.equal(isLiveSessionCard(card({ tmuxSession: "dsp-1" })), true);
  assert.equal(isLiveSessionCard(card({})), false);
  assert.equal(
    isLiveSessionCard(card({ tmuxSession: "dsp-1", sessionLost: true })),
    false,
  );
  assert.equal(
    isLiveSessionCard(
      card({ tmuxSession: "dsp-1", provisioningStep: "worktrees" }),
    ),
    false,
  );
  assert.equal(
    isLiveSessionCard(
      card({
        tmuxSession: "dsp-1",
        sessionLost: false,
        provisioningStep: null,
      }),
    ),
    true,
  );
});

test("archiveBoard refuses LOCAL and a board with a live session, then archives and restores", async () => {
  await assert.rejects(
    archiveBoard(key("LOCAL")),
    refusal(409, "default-board", "default-board"),
  );
  const first = await store.createLocalCard(key("COPY"), "one", "");
  const second = await store.createLocalCard(key("COPY"), "two", "");
  for (const card of [first, second]) {
    await store.completeStart(card.id, undefined, {
      workspacePath: path.join(env.root, "ws"),
      branch: card.id,
      tmuxSession: `dsp-${card.id}`,
    });
  }
  await assert.rejects(
    archiveBoard(key("COPY")),
    refusal(409, "sessions-running", "Stop the 2 running sessions first.", {
      running: 2,
    }),
  );
  assert.equal(store.getBoard(key("COPY"))?.archived, false);
  assert.equal(boardCounts().counts.find((c) => c.key === "COPY")?.running, 2);

  assert.equal((await archiveBoard(key("PLAT"))).archived, true);
  assert.equal((await restoreBoard(key("PLAT"))).archived, false);
});

test("archiveBoard counts a card whose start is in flight or provisioning", async () => {
  await createBoard(input({ key: "STRT", name: "Start" }), countingReader([]));
  const flagged = await store.createLocalCard(key("STRT"), "flagged", "");
  store.beginStart(flagged.id);
  await assert.rejects(
    archiveBoard(key("STRT")),
    refusal(409, "sessions-running", "Stop the 1 running session first.", {
      running: 1,
    }),
  );
  store.endStart(flagged.id);
  const provisioning = await store.createLocalCard(key("STRT"), "step", "");
  await store.setProvisioning(provisioning.id, "worktrees");
  await assert.rejects(
    archiveBoard(key("STRT")),
    refusal(409, "sessions-running", "Stop the 1 running session first.", {
      running: 1,
    }),
  );
  assert.equal(store.getBoard(key("STRT"))?.archived, false);
});

test("updateBoard LOCAL writes only the workspace folders that differ", async () => {
  const local = key("LOCAL");
  const repo = (p: string) => ({
    path: p,
    baseBranch: null,
    checkCommand: "x",
  });
  const add = mock.method(store, "addWorkspaceFolder");
  const remove = mock.method(store, "removeWorkspaceFolder");
  try {
    await updateBoard(local, { repositories: [repo(repoA)] });
    assert.equal(add.mock.callCount(), 1);
    await updateBoard(local, { repositories: [repo(repoA)] });
    assert.equal(add.mock.callCount(), 1, "an unchanged list adds nothing");
    assert.equal(remove.mock.callCount(), 0);

    await updateBoard(local, { repositories: [repo(repoA), repo(repoB)] });
    assert.equal(add.mock.callCount(), 2);
    await updateBoard(local, { repositories: [repo(repoB)] });
    assert.equal(remove.mock.callCount(), 1);
    assert.deepEqual(store.getWorkspaceFolders(local).folders, [repoB]);
  } finally {
    add.mock.restore();
    remove.mock.restore();
  }
});

const RUNNING_LOOP = {
  slug: "loop",
  roadmapFile: "units.md",
  units: [
    {
      number: 1,
      ticket: null,
      title: "unit",
      status: "not started",
      statusText: "",
      branch: null,
      commit: null,
      prdPath: null,
      phaseTotal: null,
      phases: [],
    },
  ],
  engine: null,
  completion: "running",
  summary: {
    unitsDone: 0,
    unitsTotal: 2,
    currentUnit: 1,
    currentPhase: null,
    lastGate: null,
  },
  warnings: [],
  readAt: "2026-10-06T00:00:00.000Z",
} satisfies LoopProgress;

async function startCard(id: string): Promise<void> {
  await store.completeStart(id, undefined, {
    workspacePath: path.join(env.root, "ws", id),
    branch: id,
    tmuxSession: `dsp-${id}`,
  });
}

async function startedOn(board: BoardKey, title: string): Promise<Card> {
  const card = await store.createLocalCard(board, title, "");
  await store.completeStart(card.id, undefined, {
    workspacePath: path.join(env.root, "ws", card.id),
    branch: card.id,
    tmuxSession: `dsp-${card.id}`,
  });
  return store.getCard(card.id) as Card;
}

test("boardCounts sets attention to the queue length of each board, a hand-moved Needs Input card included", async () => {
  const a = key("CNTA");
  const b = key("CNTB");
  for (const k of [a, b]) {
    await createBoard(input({ key: k, name: k }), countingReader([]));
  }
  const waiting = await startedOn(a, "waiting");
  await store.setSessionStateIfSession(
    waiting.id,
    waiting.activeSessionId as string,
    "needs_input",
  );
  const manual = await store.createLocalCard(b, "moved by hand", "");
  await store.moveCardManual(manual.id, "needs_input");
  const find = (k: BoardKey) =>
    boardCounts().counts.find((count) => count.key === k);
  assert.equal(find(a)?.attention, 1);
  assert.equal(find(b)?.attention, 1);
});

test("boardCounts counts a Needs Input group once, not once per mirrored member", async () => {
  const board = key("CNTG");
  await createBoard(input({ key: board, name: board }), countingReader([]));
  const m1 = await store.createLocalCard(board, "m1", "");
  const m2 = await store.createLocalCard(board, "m2", "");
  const group = await store.createGroupCard(board, "group", [m1.id, m2.id]);
  assert.ok(group.ok);
  if (!group.ok) return;
  await store.moveCardManual(group.card.id, "needs_input");
  assert.equal(store.getCard(m1.id)?.column, "needs_input");
  assert.equal(
    boardCounts().counts.find((count) => count.key === board)?.attention,
    1,
  );
});

test("boardCounts lists the running loops of a board, sorted by group id", async () => {
  const board = key("CNTL");
  await createBoard(input({ key: "CNTL", name: "Loops" }), countingReader([]));
  const members = async (title: string) =>
    (await store.createLocalCard(board, title, "")).id;
  const running = await store.createGroupCard(board, "running", [
    await members("r1"),
    await members("r2"),
  ]);
  const idle = await store.createGroupCard(board, "idle", [
    await members("i1"),
    await members("i2"),
  ]);
  const second = await store.createGroupCard(board, "second", [
    await members("s1"),
    await members("s2"),
  ]);
  assert.ok(running.ok && idle.ok && second.ok);
  if (!running.ok || !idle.ok || !second.ok) return;
  await startCard(second.card.id);
  await startCard(running.card.id);
  await store.setLoopProgress(second.card.id, RUNNING_LOOP);
  await store.setLoopProgress(running.card.id, RUNNING_LOOP);
  await store.setLoopProgress(idle.card.id, {
    ...RUNNING_LOOP,
    completion: "complete",
  });
  const count = boardCounts().counts.find((c) => c.key === board);
  assert.deepEqual(
    count?.loops,
    [running.card.identifier, second.card.identifier]
      .sort((x, y) => x.localeCompare(y))
      .map((groupId) => ({ groupId, percent: 0 })),
  );
  assert.deepEqual(
    boardCounts().counts.find((c) => c.key === "CNTA")?.loops,
    [],
  );
});

test("boardCounts lists a running group with no loop progress with a null percent, and the list matches runningLoops", async () => {
  const board = key("CNTN");
  await createBoard(input({ key: "CNTN", name: "NoLoop" }), countingReader([]));
  const members = async (title: string) =>
    (await store.createLocalCard(board, title, "")).id;
  const bare = await store.createGroupCard(board, "bare", [
    await members("b1"),
    await members("b2"),
  ]);
  const finished = await store.createGroupCard(board, "finished", [
    await members("f1"),
    await members("f2"),
  ]);
  const looped = await store.createGroupCard(board, "looped", [
    await members("l1"),
    await members("l2"),
  ]);
  assert.ok(bare.ok && finished.ok && looped.ok);
  if (!bare.ok || !finished.ok || !looped.ok) return;
  await startCard(bare.card.id);
  await startCard(looped.card.id);
  await store.setLoopProgress(looped.card.id, RUNNING_LOOP);
  await store.setLoopProgress(finished.card.id, {
    ...RUNNING_LOOP,
    completion: "complete",
  });
  const loops = boardCounts().counts.find((c) => c.key === board)?.loops;
  assert.equal(loops?.length, runningLoops(board));
  assert.deepEqual(
    loops?.find((l) => l.groupId === bare.card.identifier),
    { groupId: bare.card.identifier, percent: null },
  );
  assert.equal(
    loops?.some((l) => l.groupId === finished.card.identifier),
    false,
  );
});

test("boardCounts keeps an archived board with empty attention and loops", async () => {
  await createBoard(input({ key: "CNTX", name: "Gone" }), countingReader([]));
  await archiveBoard(key("CNTX"));
  const count = boardCounts().counts.find((c) => c.key === "CNTX");
  assert.equal(count?.attention, 0);
  assert.deepEqual(count?.loops, []);
});
