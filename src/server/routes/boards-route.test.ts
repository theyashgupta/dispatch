import test, { after, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { isolateEnv } from "../test-support/fixtures.js";
import { issue } from "../test-support/fake-source.js";
import {
  linearFixture,
  queueLinearFetch,
  restoreFetch,
} from "../test-support/linear-fetch.js";
import { parseBoardKey } from "../../shared/board-key.js";
import type { Board, BoardKey } from "../../shared/types.js";

const env = isolateEnv();
const { store } = await import("../store/board.store.js");
const express = (await import("express")).default;
const { boardsRouter } = await import("./boards.route.js");
const { getOrchestrationConfig, setOrchestrationConfig, updateWorkspaceRoot } =
  await import("../services/infra/config-holder.js");
const { CONFIG_PATH } = await import("../services/infra/paths.js");
const { rebuildSources } = await import("../adapters/source-gateway.js");
const { getWorkflow, invalidateWorkflow } =
  await import("../services/orchestration/linear-outbound.js");

const localSessions = path.join(env.root, "local-sessions");
const acmeSessions = path.join(env.root, "acme-sessions");
const otherSessions = path.join(env.root, "other-sessions");
const apiRepo = repo("api");
const webRepo = repo("web");
const docsRepo = repo("docs");
const plainFolder = path.join(env.root, "plain");
for (const dir of [localSessions, acmeSessions, otherSessions, plainFolder]) {
  fs.mkdirSync(dir, { recursive: true });
}

function repo(name: string): string {
  const dir = path.join(env.root, "repos", name);
  fs.mkdirSync(path.join(dir, ".git"), { recursive: true });
  return dir;
}

function key(value: string): BoardKey {
  const parsed = parseBoardKey(value);
  assert.ok(parsed, value);
  return parsed;
}

setOrchestrationConfig({ linearApiKey: "", workspaceRoot: localSessions });
await store.load();
await store.applyIssues(
  [issue("eng-1", { identifier: "ENG-1" })],
  new Date().toISOString(),
  { source: "linear" },
);

const app = express();
app.use("/api", express.json(), boardsRouter);
const server = await new Promise<import("node:http").Server>((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
after(() => {
  server.close();
  env.cleanup();
});
afterEach(() => {
  restoreFetch();
  rebuildSources({ linearApiKey: "" });
  invalidateWorkflow();
});

interface Count {
  key: string;
  running: number;
  openGroups: number;
  attention: number;
}

interface Body {
  board: Board;
  boards: Board[];
  counts: Count[];
  knownLinearTeamKeys: string[];
  at: string;
  error?: string;
}

interface Reply {
  status: number;
  text: string;
  body: Body;
}

async function call(
  method: string,
  route: string,
  body?: unknown,
): Promise<Reply> {
  const res = await fetch(`${base}${route}`, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, text, body: JSON.parse(text) as Body };
}

function acmeBody(
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    key: "ACME",
    name: "Acme",
    workspaceRoot: acmeSessions,
    repositories: [{ path: apiRepo }, { path: webRepo, baseBranch: "main" }],
    linearTeamKeys: extra.key === undefined ? ["AC"] : [],
    ...extra,
  };
}

function state(): string {
  return (
    JSON.stringify(store.listBoards()) + fs.readFileSync(CONFIG_PATH, "utf8")
  );
}

async function expectRefusal(
  reply: Promise<Reply>,
  status: number,
  error: string,
  code: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const before = state();
  const got = await reply;
  assert.equal(got.status, status, got.text);
  assert.equal(got.text, JSON.stringify({ error, code, ...extra }));
  assert.equal(state(), before, "a refused request changes nothing");
}

test("POST /boards creates a board with the D-6 defaults and GET returns it", async () => {
  const created = await call("POST", "/boards", acmeBody());
  assert.equal(created.status, 201, created.text);
  const board = created.body.board;
  assert.equal(board.key, "ACME");
  assert.equal(board.name, "Acme");
  assert.equal(board.workspaceRoot, acmeSessions);
  assert.deepEqual(board.repositories, [
    { path: apiRepo, baseBranch: null, checkCommand: "npm run check" },
    { path: webRepo, baseBranch: "main", checkCommand: "npm run check" },
  ]);
  assert.deepEqual(board.linearTeamKeys, ["AC"]);
  assert.equal(board.archived, false);
  assert.equal(board.policy.supervisor, "on");
  assert.equal(board.policy.concurrencyCap, 3);

  const one = await call("GET", "/boards/ACME");
  assert.equal(one.status, 200);
  assert.deepEqual(one.body.board, board);
  const list = await call("GET", "/boards");
  assert.equal(list.status, 200);
  assert.deepEqual(
    list.body.boards.map((b) => b.key),
    ["LOCAL", "ACME"],
  );
});

test("GET /boards shows the default board with its folders from Config and the workspace folders", async () => {
  const list = await call("GET", "/boards");
  const local = list.body.boards[0];
  assert.equal(local.key, "LOCAL");
  assert.equal(local.workspaceRoot, localSessions);
  assert.deepEqual(local.repositories, []);
});

test("GET /boards holds the identifier prefixes of the Linear cards and no Linear read when Linear is off", async () => {
  const list = await call("GET", "/boards");
  assert.deepEqual(list.body.knownLinearTeamKeys, ["ENG"]);
});

test("GET /boards adds the Linear team keys when Linear is on, and skips a failed read", async () => {
  rebuildSources({ linearApiKey: "k", sources: { linear: { apiKey: "k" } } });
  queueLinearFetch([[200, linearFixture("workflow.json")]]);
  const on = await call("GET", "/boards");
  assert.deepEqual(on.body.knownLinearTeamKeys, ["ENG", "X"]);

  invalidateWorkflow();
  queueLinearFetch([[500, {}]]);
  const failed = await call("GET", "/boards");
  assert.equal(failed.status, 200);
  assert.deepEqual(failed.body.knownLinearTeamKeys, ["ENG"]);
});

const platTeams = {
  data: {
    viewer: { id: "u" },
    teams: { nodes: [{ id: "t", key: "PLAT", name: "Platform", states: {} }] },
  },
};

test("GET /boards skips silently when Linear is off, and logs and caches a failed read for 60 s", async () => {
  const warn = mock.method(console, "warn", () => undefined);
  try {
    await call("GET", "/boards");
    await call("GET", "/boards");
    assert.equal(warn.mock.callCount(), 0, "Linear off logs nothing");

    rebuildSources({ linearApiKey: "k", sources: { linear: { apiKey: "k" } } });
    mock.timers.enable({ apis: ["Date"], now: Date.now() });
    const sent = queueLinearFetch([]);
    await call("GET", "/boards");
    const afterFirst = sent.length;
    assert.ok(afterFirst >= 1);
    assert.equal(warn.mock.callCount(), 1);
    await call("GET", "/boards");
    await call("POST", "/boards", acmeBody({ key: "ENG", name: "Eng" }));
    assert.equal(sent.length, afterFirst, "no second read within 60 s");
    assert.equal(warn.mock.callCount(), 1);

    mock.timers.tick(60_001);
    await call("GET", "/boards");
    assert.ok(sent.length > afterFirst, "the read runs again after 60 s");
    assert.equal(warn.mock.callCount(), 2);

    const beforeReset = sent.length;
    invalidateWorkflow();
    await call("GET", "/boards");
    assert.ok(sent.length > beforeReset, "a reset forgets the failure");
    assert.equal(warn.mock.callCount(), 3);

    queueLinearFetch([[200, platTeams]]);
    assert.equal((await getWorkflow()).ok, true, "Linear is back");
    await expectRefusal(
      call("POST", "/boards", acmeBody({ key: "PLAT", name: "Plat" })),
      400,
      "Linear team PLAT uses this key.",
      "linear-team-key",
    );
  } finally {
    mock.timers.reset();
    warn.mock.restore();
  }
});

test("PATCH /boards/:key changes the name and repositories and keeps the key", async () => {
  const patched = await call("PATCH", "/boards/ACME", {
    name: "Acme Corp",
    repositories: [{ path: docsRepo, baseBranch: "release/1.0" }],
    linearTeamKeys: ["AC", "AD"],
  });
  assert.equal(patched.status, 200, patched.text);
  const board = patched.body.board;
  assert.equal(board.key, "ACME");
  assert.equal(board.name, "Acme Corp");
  assert.deepEqual(board.repositories, [
    {
      path: docsRepo,
      baseBranch: "release/1.0",
      checkCommand: "npm run check",
    },
  ]);
  assert.deepEqual(board.linearTeamKeys, ["AC", "AD"]);
  assert.equal(board.workspaceRoot, acmeSessions);
  assert.equal(board.policy.supervisor, "on");

  const moved = await call("PATCH", "/boards/ACME", {
    workspaceRoot: otherSessions,
  });
  assert.equal(moved.body.board.workspaceRoot, otherSessions);
  assert.equal((await call("PATCH", "/boards/ACME", {})).status, 200);
});

test("PATCH /boards/LOCAL writes Config.workspaceRoot and the workspace folders, and drops the branch and check command", async () => {
  const patched = await call("PATCH", "/boards/LOCAL", {
    name: "Home",
    workspaceRoot: otherSessions,
    repositories: [
      { path: apiRepo, baseBranch: "develop", checkCommand: "make test" },
      { path: webRepo },
    ],
  });
  assert.equal(patched.status, 200, patched.text);
  const board = patched.body.board;
  assert.equal(board.name, "Home");
  assert.equal(board.workspaceRoot, otherSessions);
  assert.deepEqual(board.repositories, [
    { path: apiRepo, baseBranch: null, checkCommand: "npm run check" },
    { path: webRepo, baseBranch: null, checkCommand: "npm run check" },
  ]);
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")) as {
    workspaceRoot: string;
  };
  assert.equal(config.workspaceRoot, otherSessions);
  assert.deepEqual(store.getWorkspaceFolders(key("LOCAL")).folders, [
    apiRepo,
    webRepo,
  ]);
  assert.equal(
    store.getBoard(key("LOCAL"))?.workspaceRoot,
    null,
    "the board row never holds the default folders",
  );

  const shrunk = await call("PATCH", "/boards/LOCAL", {
    repositories: [{ path: webRepo }],
  });
  assert.deepEqual(
    shrunk.body.board.repositories.map((r) => r.path),
    [webRepo],
  );
  assert.deepEqual(store.getWorkspaceFolders(key("LOCAL")).folders, [webRepo]);
});

test("PATCH /boards/LOCAL accepts the folders and sessions folder that GET returns, even when the folder is not created yet", async () => {
  const local = key("LOCAL");
  await store.addWorkspaceFolder(local, plainFolder);
  const folders = store.getWorkspaceFolders(local).folders;
  const got = (await call("GET", "/boards/LOCAL")).body.board;
  assert.ok(got.repositories.some((r) => r.path === plainFolder));
  const echo = await call("PATCH", "/boards/LOCAL", {
    name: got.name,
    workspaceRoot: got.workspaceRoot,
    repositories: got.repositories,
  });
  assert.equal(echo.status, 200, echo.text);
  assert.deepEqual(store.getWorkspaceFolders(local).folders, folders);

  const root = getOrchestrationConfig()?.workspaceRoot ?? "";
  const notYet = path.join(env.root, "not-yet");
  updateWorkspaceRoot(notYet);
  try {
    const unchanged = await call("PATCH", "/boards/LOCAL", {
      workspaceRoot: notYet,
    });
    assert.equal(unchanged.status, 200, unchanged.text);
    updateWorkspaceRoot(`${notYet}/`);
    const slashed = (await call("GET", "/boards/LOCAL")).body.board;
    assert.equal(slashed.workspaceRoot, notYet, "GET shows the resolved root");
    const echoSlashed = await call("PATCH", "/boards/LOCAL", {
      workspaceRoot: slashed.workspaceRoot,
    });
    assert.equal(echoSlashed.status, 200, echoSlashed.text);
    await expectRefusal(
      call("PATCH", "/boards/LOCAL", {
        workspaceRoot: path.join(env.root, "other-missing"),
      }),
      400,
      "This folder does not exist.",
      "folder-missing",
      { field: "workspaceRoot" },
    );
  } finally {
    updateWorkspaceRoot(root);
    await store.removeWorkspaceFolder(local, plainFolder);
  }
});

test("archive and restore work when no session runs", async () => {
  const archived = await call("POST", "/boards/ACME/archive");
  assert.equal(archived.status, 200, archived.text);
  assert.equal(archived.body.board.archived, true);
  assert.equal((await call("GET", "/boards/ACME")).body.board.archived, true);
  const restored = await call("POST", "/boards/ACME/restore");
  assert.equal(restored.status, 200, restored.text);
  assert.equal(restored.body.board.archived, false);
  assert.equal((await call("POST", "/boards/ACME/restore")).status, 200);
});

test("GET /boards/counts gives one entry per board, archived ones included, and is not read as a key", async () => {
  await call("POST", "/boards", acmeBody({ key: "RUNB", name: "Running" }));
  const running = await store.createLocalCard(key("RUNB"), "live", "");
  await store.completeStart(running.id, undefined, {
    workspacePath: path.join(env.root, "ws"),
    branch: running.id,
    tmuxSession: "dsp-live",
  });
  const waiting = await store.createLocalCard(key("RUNB"), "waiting", "");
  await store.moveCardManual(waiting.id, "needs_input");
  const a = await store.createLocalCard(key("RUNB"), "a", "");
  const b = await store.createLocalCard(key("RUNB"), "b", "");
  const group = await store.createGroupCard(key("RUNB"), "group", [a.id, b.id]);
  assert.equal(group.ok, true);
  await call("POST", "/boards", acmeBody({ key: "OLDB", name: "Old" }));
  await call("POST", "/boards/OLDB/archive");

  const before = Date.now();
  const counts = await call("GET", "/boards/counts");
  assert.equal(counts.status, 200, counts.text);
  assert.deepEqual(
    (counts.body.counts as { key: string }[]).map((c) => c.key),
    ["LOCAL", "ACME", "RUNB", "OLDB"],
  );
  const byKey = Object.fromEntries(
    (
      counts.body.counts as {
        key: string;
        running: number;
        openGroups: number;
        attention: number;
      }[]
    ).map((c) => [c.key, c]),
  );
  assert.deepEqual(byKey.RUNB, {
    key: "RUNB",
    running: 1,
    openGroups: 1,
    attention: 1,
  });
  assert.deepEqual(byKey.OLDB, {
    key: "OLDB",
    running: 0,
    openGroups: 0,
    attention: 0,
  });
  assert.ok(Math.abs(Date.parse(counts.body.at) - before) < 10_000);
});

test("GET /boards/counts leaves a Done group, a lost card and a provisioning card out of the counts", async () => {
  await call("POST", "/boards", acmeBody({ key: "CNTX", name: "Counted" }));
  const board = key("CNTX");
  const start = async (title: string) => {
    const card = await store.createLocalCard(board, title, "");
    await store.completeStart(card.id, undefined, {
      workspacePath: path.join(env.root, "ws", card.id),
      branch: card.id,
      tmuxSession: `dsp-${card.id}`,
    });
    return card;
  };
  const group = async (title: string) => {
    const a = await store.createLocalCard(board, `${title} a`, "");
    const b = await store.createLocalCard(board, `${title} b`, "");
    const minted = await store.createGroupCard(board, title, [a.id, b.id]);
    assert.ok(minted.ok);
    return minted.card;
  };
  const counted = async () => {
    const got = await call("GET", "/boards/counts");
    assert.equal(got.status, 200, got.text);
    return (got.body.counts as { key: string }[]).find((c) => c.key === "CNTX");
  };
  await start("running");
  assert.deepEqual(await counted(), {
    key: "CNTX",
    running: 1,
    openGroups: 0,
    attention: 0,
  });

  const lost = await start("lost");
  await store.markSessionLost(lost.id, undefined);
  const restarting = await start("restarting");
  await store.setProvisioning(restarting.id, "Creating worktrees");
  await group("open group");
  const done = await group("done group");
  await store.moveCardManual(done.id, "done");
  assert.equal(store.getCard(done.id)?.column, "done");
  assert.deepEqual(await counted(), {
    key: "CNTX",
    running: 1,
    openGroups: 1,
    attention: 0,
  });
});

test("a board keyed COUNTS reads as a board, not as the counts route", async () => {
  const created = await call(
    "POST",
    "/boards",
    acmeBody({ key: "COUNTS", name: "Counts" }),
  );
  assert.equal(created.status, 201);
  const read = await call("GET", "/boards/COUNTS");
  assert.equal(read.status, 200);
  assert.equal((read.body as { board: { key: string } }).board.key, "COUNTS");
});

test("POST /boards refuses each bad key with the exact UI copy", async () => {
  const invalid =
    "Use 2 to 6 capital letters or digits, starting with a letter.";
  for (const bad of ["acme", "A", "1AB", "TOOLONG", "AC ME", "", "AC-ME"]) {
    await expectRefusal(
      call("POST", "/boards", acmeBody({ key: bad })),
      400,
      invalid,
      "invalid-key",
    );
  }
  await expectRefusal(
    call("POST", "/boards", { ...acmeBody(), key: undefined }),
    400,
    invalid,
    "invalid-key",
  );
  for (const reserved of ["LOCAL", "GROUP"]) {
    await expectRefusal(
      call("POST", "/boards", acmeBody({ key: reserved })),
      400,
      "LOCAL and GROUP are reserved.",
      "reserved-key",
    );
  }
});

test("POST /boards refuses a duplicate key and a key a Linear team or Linear card uses", async () => {
  await expectRefusal(
    call("POST", "/boards", acmeBody({ name: "Other" })),
    400,
    "Board Acme Corp uses this key.",
    "duplicate-key",
  );
  await expectRefusal(
    call("POST", "/boards", acmeBody({ key: "ENG", name: "Eng" })),
    400,
    "Linear team ENG uses this key.",
    "linear-team-key",
  );
});

test("create and PATCH refuse a team key that another board lists, and LOCAL or GROUP as a team key", async () => {
  await expectRefusal(
    call("POST", "/boards", acmeBody({ key: "TAKE", linearTeamKeys: ["AC"] })),
    400,
    "Board Acme Corp lists Linear team AC.",
    "team-key-taken",
  );
  assert.equal((await call("GET", "/boards/TAKE")).status, 404);
  await expectRefusal(
    call("PATCH", "/boards/RUNB", { linearTeamKeys: ["AD"] }),
    400,
    "Board Acme Corp lists Linear team AD.",
    "team-key-taken",
  );
  const own = await call("PATCH", "/boards/ACME", {
    linearTeamKeys: ["AC", "AD"],
  });
  assert.equal(own.status, 200, own.text);
  for (const reserved of ["LOCAL", "GROUP"]) {
    await expectRefusal(
      call("PATCH", "/boards/RUNB", { linearTeamKeys: [reserved] }),
      400,
      "LOCAL and GROUP are reserved.",
      "reserved-key",
    );
    await expectRefusal(
      call(
        "POST",
        "/boards",
        acmeBody({ key: "RSVD", linearTeamKeys: [reserved] }),
      ),
      400,
      "LOCAL and GROUP are reserved.",
      "reserved-key",
    );
  }
});

test("POST /boards checks the Linear team keys only when Linear answers", async () => {
  rebuildSources({ linearApiKey: "k", sources: { linear: { apiKey: "k" } } });
  queueLinearFetch([[200, platTeams]]);
  await expectRefusal(
    call("POST", "/boards", acmeBody({ key: "PLAT", name: "Plat" })),
    400,
    "Linear team PLAT uses this key.",
    "linear-team-key",
  );

  invalidateWorkflow();
  queueLinearFetch([[500, {}]]);
  const created = await call(
    "POST",
    "/boards",
    acmeBody({ key: "PLAT", name: "Plat" }),
  );
  assert.equal(created.status, 201, created.text);
});

test("POST /boards refuses a missing name, folder and repositories with the exact UI copy", async () => {
  for (const name of ["", "   ", undefined, 7]) {
    await expectRefusal(
      call("POST", "/boards", acmeBody({ key: "NAME", name })),
      400,
      "Enter a name.",
      "missing-name",
    );
  }
  const folder = "This folder does not exist.";
  await expectRefusal(
    call(
      "POST",
      "/boards",
      acmeBody({ key: "FOLD", workspaceRoot: path.join(env.root, "gone") }),
    ),
    400,
    folder,
    "folder-missing",
    { field: "workspaceRoot" },
  );
  for (const bad of [undefined, "relative/dir", "~/x", "/a/../b", 7]) {
    await expectRefusal(
      call("POST", "/boards", acmeBody({ key: "FOLD", workspaceRoot: bad })),
      400,
      folder,
      "folder-missing",
    );
  }
  await expectRefusal(
    call(
      "POST",
      "/boards",
      acmeBody({ key: "FOLD", repositories: [{ path: plainFolder }] }),
    ),
    400,
    folder,
    "folder-missing",
    { field: "repositories", path: plainFolder },
  );
  for (const repositories of [[], undefined, "x"]) {
    await expectRefusal(
      call("POST", "/boards", acmeBody({ key: "REPO", repositories })),
      400,
      "Add at least one repository.",
      "no-repositories",
    );
  }
});

test("POST /boards refuses a bad base branch, check command and team keys", async () => {
  for (const [repositories, code] of [
    [[{ path: apiRepo, baseBranch: "-rf" }], "invalid-base-branch"],
    [[{ path: apiRepo, baseBranch: "a..b" }], "invalid-base-branch"],
    [[{ path: apiRepo, checkCommand: "" }], "invalid-check-command"],
  ] as const) {
    const got = await call(
      "POST",
      "/boards",
      acmeBody({ key: "BADR", repositories }),
    );
    assert.equal(got.status, 400);
    assert.deepEqual(got.body, { error: code });
  }
  const teams = await call(
    "POST",
    "/boards",
    acmeBody({ key: "BADT", linearTeamKeys: ["eng"] }),
  );
  assert.deepEqual(teams.body, { error: "invalid-linear-team-keys" });
  assert.equal(
    store.getBoard(key("BADR")) ?? store.getBoard(key("BADT")),
    undefined,
  );
});

test("PATCH /boards/:key refuses a bad field and changes nothing", async () => {
  const folder = "This folder does not exist.";
  await expectRefusal(
    call("PATCH", "/boards/ACME", { name: " " }),
    400,
    "Enter a name.",
    "missing-name",
  );
  await expectRefusal(
    call("PATCH", "/boards/ACME", {
      workspaceRoot: path.join(env.root, "gone"),
    }),
    400,
    folder,
    "folder-missing",
    { field: "workspaceRoot" },
  );
  await expectRefusal(
    call("PATCH", "/boards/LOCAL", {
      name: "Changed",
      workspaceRoot: path.join(env.root, "gone"),
    }),
    400,
    folder,
    "folder-missing",
    { field: "workspaceRoot" },
  );
  await expectRefusal(
    call("PATCH", "/boards/ACME", { repositories: [] }),
    400,
    "Add at least one repository.",
    "no-repositories",
  );
  await expectRefusal(
    call("PATCH", "/boards/ACME", { repositories: [{ path: plainFolder }] }),
    400,
    folder,
    "folder-missing",
    { field: "repositories", path: plainFolder },
  );
  for (const field of ["key", "policy", "archived"]) {
    const before = state();
    const got = await call("PATCH", "/boards/ACME", { [field]: "ZZZ" });
    assert.equal(got.status, 400);
    assert.deepEqual(got.body, { error: "unsupported-field" });
    assert.equal(state(), before);
  }
});

test("archive refuses the default board and a board with a live session", async () => {
  await expectRefusal(
    call("POST", "/boards/LOCAL/archive"),
    409,
    "default-board",
    "default-board",
  );
  await expectRefusal(
    call("POST", "/boards/RUNB/archive"),
    409,
    "Stop the 1 running sessions first.",
    "sessions-running",
    { running: 1 },
  );
  assert.equal((await call("GET", "/boards/RUNB")).body.board.archived, false);
});

test("an unknown board answers 404 and a malformed key answers 400 on each key route", async () => {
  for (const [method, route] of [
    ["GET", "/boards/NOPE"],
    ["PATCH", "/boards/NOPE"],
    ["POST", "/boards/NOPE/archive"],
    ["POST", "/boards/NOPE/restore"],
  ] as const) {
    await expectRefusal(
      call(method, route, method === "PATCH" ? {} : undefined),
      404,
      "unknown-board",
      "unknown-board",
    );
  }
  for (const [method, route] of [
    ["GET", "/boards/acme"],
    ["PATCH", "/boards/a"],
    ["POST", "/boards/TOOLONG1/archive"],
    ["POST", "/boards/1AB/restore"],
  ] as const) {
    await expectRefusal(
      call(method, route, method === "PATCH" ? {} : undefined),
      400,
      "invalid-board",
      "invalid-board",
    );
  }
});

test("the API router mounts the board routes, with counts ahead of the key route", async () => {
  const { apiRouter } = await import("./index.js");
  const mounted = express();
  mounted.use("/api", express.json(), apiRouter);
  const s = await new Promise<import("node:http").Server>((resolve) => {
    const l = mounted.listen(0, "127.0.0.1", () => resolve(l));
  });
  try {
    const url = `http://127.0.0.1:${(s.address() as { port: number }).port}/api`;
    const counts = await fetch(`${url}/boards/counts`);
    assert.equal(counts.status, 200);
    assert.ok(
      Array.isArray(((await counts.json()) as { counts: unknown }).counts),
    );
    assert.equal((await fetch(`${url}/boards/LOCAL`)).status, 200);
  } finally {
    s.close();
  }
});
