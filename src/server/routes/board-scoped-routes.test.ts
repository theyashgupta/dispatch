import test, { after, type TestContext } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { Server } from "node:http";
import type {
  ActivityEvent,
  ArchivedGroupSummary,
  BoardKey,
  BoardSnapshot,
  Card,
  WorkspacesInventory,
} from "../../shared/types.js";
import type { CardSearchResult } from "../../shared/search.js";
import {
  ALL_BOARDS,
  DEFAULT_BOARD_KEY,
  parseBoardKey,
} from "../../shared/board-key.js";
import { isolateEnv, waitFor } from "../test-support/fixtures.js";
import { fakeItem } from "../test-support/fake-source.js";
import { tempRepoWithWorkspace } from "../test-support/git-fixtures.js";
import { startedGroup } from "../test-support/group-fixtures.js";

const env = isolateEnv();
const { store } = await import("../store/board.store.js");
const express = (await import("express")).default;
const { boardRouter } = await import("./board.route.js");
const { cardsRouter } = await import("./cards.route.js");
const { eventsRouter } = await import("./events.route.js");
const { archiveRouter } = await import("./archive.route.js");
const { workspacesRouter } = await import("./workspaces.route.js");
const { itemsRouter } = await import("./items.route.js");
const { sessionsRouter } = await import("./sessions.route.js");
const { setOrchestrationConfig } =
  await import("../services/infra/config-holder.js");
const { unwindGroup } = await import("../services/orchestration/unwind.js");

function key(value: string): BoardKey {
  const parsed = parseBoardKey(value);
  assert.ok(parsed, value);
  return parsed;
}

const ACME = key("ACME");
const BETA = key("BETA");
const LOCAL = DEFAULT_BOARD_KEY;

const fixtureRoots: string[] = [];

async function folder(): Promise<string> {
  const { root } = await tempRepoWithWorkspace();
  fixtureRoots.push(root);
  return root;
}

const acmeFolder = await folder();
const localFolder = await folder();
const betaFolder = await folder();

setOrchestrationConfig({
  linearApiKey: "",
  workspaceRoot: path.join(env.root, "sessions"),
});
await store.load();
for (const [board, name, repo] of [
  [ACME, "Acme", path.join(acmeFolder, "repo")],
  [BETA, "Beta", path.join(betaFolder, "repo")],
] as const) {
  await store.createBoard({
    key: board,
    name,
    workspaceRoot: path.join(env.root, "sessions", name),
    repositories: [
      { path: repo, baseBranch: "main", checkCommand: "npm run check" },
    ],
    linearTeamKeys: [],
  });
}
const betaCard = await store.createLocalCard(BETA, "shared word beta", "");
const betaLive = await startedGroup(store, { board: BETA });
const betaArchivedGroup = await startedGroup(store, { board: BETA });
assert.equal((await unwindGroup(betaArchivedGroup.g.id, "todo")).ok, true);
await store.setBoardArchived(BETA, true);

const app = express();
app.use(
  "/api",
  express.json(),
  boardRouter,
  cardsRouter,
  eventsRouter,
  archiveRouter,
  workspacesRouter,
  itemsRouter,
  sessionsRouter,
);
const server: Server = await new Promise((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
after(() => {
  server.close();
  for (const root of fixtureRoots) fs.rmSync(root, { recursive: true });
  env.cleanup();
});

async function call(
  method: string,
  route: string,
  body?: unknown,
): Promise<{ status: number; text: string; json: unknown }> {
  const res = await fetch(`${base}${route}`, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return {
    status: res.status,
    text,
    json: text === "" ? null : (JSON.parse(text) as unknown),
  };
}

async function get<T>(route: string): Promise<T> {
  const got = await call("GET", route);
  assert.equal(got.status, 200, got.text);
  return got.json as T;
}

const localTodo = await store.createLocalCard(LOCAL, "shared word local", "");
const acmeTodo = await store.createLocalCard(ACME, "shared word acme", "");
const localGroup = await startedGroup(store);
const acmeGroup = await startedGroup(store, { board: ACME });
for (const g of [localGroup.g, acmeGroup.g]) {
  await store.moveCardManual(g.id, "in_review");
}
const localArchived = await startedGroup(store);
const acmeArchived = await startedGroup(store, { board: ACME });
for (const g of [localArchived.g, acmeArchived.g]) {
  assert.equal((await unwindGroup(g.id, "todo")).ok, true);
}

function ids(cards: { id: string }[]): string[] {
  return cards.map((c) => c.id).sort();
}

test("GET /board holds only the cards of the board, and no board means LOCAL", async () => {
  const acme = await get<BoardSnapshot>("/board?board=ACME");
  assert.equal(acme.boardKey, "ACME");
  assert.ok(acme.cards.length > 0);
  assert.ok(acme.cards.every((c) => c.boardKey === "ACME"));
  assert.ok(acme.cards.some((c) => c.id === acmeTodo.id));
  const local = await get<BoardSnapshot>("/board");
  assert.equal(local.boardKey, "LOCAL");
  assert.ok(local.cards.every((c) => (c.boardKey ?? "LOCAL") === "LOCAL"));
  assert.ok(local.cards.some((c) => c.id === localTodo.id));
  assert.deepEqual(await get("/board?board=LOCAL"), local);
});

test("GET /search finds a card on its own board only", async () => {
  const acme = await get<{ results: CardSearchResult[]; total: number }>(
    "/search?q=shared%20word&board=ACME",
  );
  assert.deepEqual(ids(acme.results), [acmeTodo.id]);
  const local = await get<{ results: CardSearchResult[]; total: number }>(
    "/search?q=shared%20word",
  );
  assert.deepEqual(ids(local.results), [localTodo.id]);
});

test("GET /events lists the activity of the board only", async () => {
  const acme = await get<{ events: ActivityEvent[] }>("/events?board=ACME");
  const onAcme = (e: ActivityEvent) => e.cardId?.startsWith("ACME-") ?? false;
  assert.ok(acme.events.some((e) => e.cardId === acmeTodo.id));
  assert.ok(acme.events.every(onAcme));
  const local = await get<{ events: ActivityEvent[] }>("/events");
  assert.ok(local.events.some((e) => e.cardId === localTodo.id));
  assert.ok(local.events.every((e) => !onAcme(e)));
});

test("GET /archive lists the archived groups of the board only", async () => {
  const acme = await get<{ archived: ArchivedGroupSummary[] }>(
    "/archive?board=ACME",
  );
  assert.deepEqual(ids(acme.archived), [acmeArchived.g.id]);
  const local = await get<{ archived: ArchivedGroupSummary[] }>("/archive");
  assert.deepEqual(ids(local.archived), [localArchived.g.id]);
});

test("the workspace folder routes read and write the folders of the board only", async () => {
  const folders = (route: string) =>
    get<{ folders: string[] }>(route).then((r) => r.folders);
  assert.deepEqual(await folders("/workspace-folders?board=ACME"), [
    path.join(acmeFolder, "repo"),
  ]);
  assert.deepEqual(await folders("/workspace-folders"), []);

  const added = await call("POST", "/workspace-folders", { path: localFolder });
  assert.equal(added.status, 200, added.text);
  assert.deepEqual(await folders("/workspace-folders"), [localFolder]);
  assert.deepEqual(await folders("/workspace-folders?board=ACME"), [
    path.join(acmeFolder, "repo"),
  ]);

  const localRepo = path.join(localFolder, "repo");
  const addedAcme = await call("POST", "/workspace-folders?board=ACME", {
    path: localRepo,
  });
  assert.equal(addedAcme.status, 200, addedAcme.text);
  assert.deepEqual(await folders("/workspace-folders?board=ACME"), [
    path.join(acmeFolder, "repo"),
    localRepo,
  ]);

  const removed = await call("DELETE", "/workspace-folders?board=ACME", {
    path: localRepo,
  });
  assert.equal(removed.status, 200, removed.text);
  assert.deepEqual(await folders("/workspace-folders?board=ACME"), [
    path.join(acmeFolder, "repo"),
  ]);
  assert.deepEqual(await folders("/workspace-folders"), [localFolder]);
});

test("a folder of a board other than LOCAL must hold .git, and the last repository cannot go", async () => {
  const acmeRepo = path.join(acmeFolder, "repo");
  const before = JSON.stringify(store.getWorkspaceFolders(ACME));
  const parent = await call("POST", "/workspace-folders?board=ACME", {
    path: localFolder,
  });
  assert.equal(parent.status, 400);
  assert.deepEqual(parent.json, { error: "Not a git repository" });
  assert.equal(JSON.stringify(store.getWorkspaceFolders(ACME)), before);

  const last = await call("DELETE", "/workspace-folders?board=ACME", {
    path: acmeRepo,
  });
  assert.equal(last.status, 400);
  assert.deepEqual(last.json, {
    error: "Add at least one repository.",
    code: "no-repositories",
  });
  assert.equal(JSON.stringify(store.getWorkspaceFolders(ACME)), before);

  const absent = await call("DELETE", "/workspace-folders?board=ACME", {
    path: path.join(localFolder, "other"),
  });
  assert.equal(absent.status, 200, absent.text);
  assert.equal(JSON.stringify(store.getWorkspaceFolders(ACME)), before);
});

test("the workspace folder routes refuse an unknown board and a folder add on an archived one", async () => {
  const before = JSON.stringify(store.getWorkspaceFolders(LOCAL));
  const unknown = await call("POST", "/workspace-folders?board=NOPE", {
    path: localFolder,
  });
  assert.equal(unknown.status, 404);
  assert.deepEqual(unknown.json, {
    error: "unknown-board",
    code: "unknown-board",
  });
  const archived = await call("POST", "/workspace-folders?board=BETA", {
    path: localFolder,
  });
  assert.equal(archived.status, 409);
  assert.deepEqual(archived.json, {
    error: "board-archived",
    code: "board-archived",
  });
  assert.equal(JSON.stringify(store.getWorkspaceFolders(LOCAL)), before);
  assert.equal(store.getBoard(BETA)?.repositories.length, 1);
  const discovered = await call(
    "GET",
    `/workspace-folders/discover?board=ACME&path=${encodeURIComponent(acmeFolder)}`,
  );
  assert.equal(discovered.status, 200, discovered.text);
  const discoverUnknown = await call(
    "GET",
    `/workspace-folders/discover?board=NOPE&path=${encodeURIComponent(acmeFolder)}`,
  );
  assert.equal(discoverUnknown.status, 404);
});

test("GET /workspaces lists the worktrees of the board only", async () => {
  for (const [board, title] of [
    [ACME, "acme worktree"],
    [LOCAL, "local worktree"],
  ] as const) {
    const card = await store.createLocalCard(board, title, "");
    const ws = path.join(env.root, "ws", card.id);
    fs.mkdirSync(ws, { recursive: true });
    await store.completeStart(card.id, undefined, {
      workspacePath: ws,
      tmuxSession: `dsp-${card.id}-absent`,
      branch: card.id,
    });
  }
  const acme = await get<WorkspacesInventory>("/workspaces?board=ACME");
  assert.ok(acme.worktrees.some((w) => w.title === "acme worktree"));
  assert.ok(acme.worktrees.every((w) => w.cardId.startsWith("ACME-")));
  const local = await get<WorkspacesInventory>("/workspaces");
  assert.ok(local.worktrees.some((w) => w.title === "local worktree"));
  assert.ok(local.worktrees.every((w) => !w.cardId.startsWith("ACME-")));
});

test("every collection route that takes a board keeps ACME out of the no-board response and returns it with board=ACME", async () => {
  const worktreeCard = await store.createLocalCard(ACME, "walk worktree", "");
  const worktree = path.join(env.root, "ws", worktreeCard.id);
  fs.mkdirSync(worktree, { recursive: true });
  await store.completeStart(worktreeCard.id, undefined, {
    workspacePath: worktree,
    tmuxSession: `dsp-${worktreeCard.id}-absent`,
    branch: worktreeCard.id,
  });
  const routes: [string, string][] = [
    ["/board", acmeTodo.id],
    ["/cards", acmeTodo.id],
    ["/search?q=shared%20word", acmeTodo.id],
    ["/events", acmeTodo.id],
    ["/archive", acmeArchived.g.id],
    ["/sessions", acmeGroup.g.id],
    ["/workspaces", worktreeCard.id],
    ["/workspace-folders", path.join(acmeFolder, "repo")],
  ];
  for (const [route, marker] of routes) {
    const scopedRoute = `${route}${route.includes("?") ? "&" : "?"}board=ACME`;
    const plain = await call("GET", route);
    const scoped = await call("GET", scopedRoute);
    assert.equal(plain.status, 200, plain.text);
    assert.equal(scoped.status, 200, scoped.text);
    assert.ok(!plain.text.includes(marker), `${route} leaks ${marker}`);
    assert.doesNotMatch(plain.text, /ACME-\d/, route);
    assert.ok(scoped.text.includes(marker), `${scopedRoute} lacks ${marker}`);
  }
});

test("an archived board still serves its cards on every read route", async () => {
  const snapshot = await get<BoardSnapshot>("/board?board=BETA");
  assert.equal(snapshot.boardKey, "BETA");
  assert.ok(snapshot.cards.some((c) => c.id === betaCard.id));
  assert.ok(snapshot.cards.every((c) => c.boardKey === "BETA"));

  const list = await get<{ cards: Card[]; total: number }>("/cards?board=BETA");
  assert.ok(list.total >= 1);
  assert.ok(list.cards.some((c) => c.id === betaCard.id));

  const search = await get<{ results: CardSearchResult[] }>(
    "/search?q=shared%20word&board=BETA",
  );
  assert.deepEqual(ids(search.results), [betaCard.id]);

  const events = await get<{ events: ActivityEvent[] }>("/events?board=BETA");
  assert.ok(events.events.some((e) => e.cardId === betaCard.id));
  assert.ok(events.events.every((e) => e.cardId?.startsWith("BETA-")));

  const archive = await get<{ archived: ArchivedGroupSummary[] }>(
    "/archive?board=BETA",
  );
  assert.deepEqual(ids(archive.archived), [betaArchivedGroup.g.id]);

  const sessions = await get<{ sessions: { cardId: string }[] }>(
    "/sessions?board=BETA",
  );
  assert.deepEqual(
    sessions.sessions.map((s) => s.cardId),
    [betaLive.g.id],
  );

  const folders = await get<{ folders: string[] }>(
    "/workspace-folders?board=BETA",
  );
  assert.deepEqual(folders.folders, [path.join(betaFolder, "repo")]);
});

test("POST /cards creates on the board named, and on LOCAL with no board", async () => {
  const onAcme = await call("POST", "/cards?board=ACME", {
    title: "made on acme",
    description: "d",
  });
  assert.equal(onAcme.status, 201, onAcme.text);
  const acmeCard = onAcme.json as { id: string; boardKey: string };
  assert.match(acmeCard.id, /^ACME-\d+$/);
  assert.equal(acmeCard.boardKey, "ACME");
  const onLocal = await call("POST", "/cards", {
    title: "made on local",
    description: "d",
  });
  assert.equal(onLocal.status, 201, onLocal.text);
  const localCard = onLocal.json as { id: string; boardKey: string };
  assert.match(localCard.id, /^LOCAL-\d+$/);
  assert.equal(localCard.boardKey, "LOCAL");
  const acme = await get<BoardSnapshot>("/board?board=ACME");
  assert.ok(acme.cards.some((c) => c.id === acmeCard.id));
  assert.ok(acme.cards.every((c) => c.id !== localCard.id));
});

test("a create names its refusal: 404 unknown board, 400 malformed board, 409 archived board", async () => {
  const card = { title: "t", description: "d" };
  const group = { title: "t", memberIds: ["a", "b"] };
  const cases: [string, unknown, number, string][] = [
    ["/cards?board=NOPE", card, 404, "unknown-board"],
    ["/cards?board=bad!", card, 400, "invalid-board"],
    ["/cards?board=BETA", card, 409, "board-archived"],
    ["/cards/group?board=BETA", group, 409, "board-archived"],
    ["/items/fake:p1/promote?board=BETA", {}, 409, "board-archived"],
  ];
  const before = store.listCards(BETA).length;
  for (const [route, body, status, code] of cases) {
    const got = await call("POST", route, body);
    assert.equal(got.status, status, route);
    assert.deepEqual(got.json, { error: code, code }, route);
  }
  assert.equal(store.listCards(BETA).length, before);
  assert.equal(
    (await get<BoardSnapshot>("/board?board=BETA")).boardKey,
    "BETA",
  );
});

test("a card route reads the board stored on the card and ignores the board parameter", async () => {
  const plain = await call("GET", `/cards/${acmeTodo.id}`);
  assert.equal(plain.status, 200, plain.text);
  const named = await call("GET", `/cards/${acmeTodo.id}?board=LOCAL`);
  assert.equal(named.text, plain.text);
  const junk = await call("GET", `/cards/${acmeTodo.id}?board=bad!`);
  assert.equal(junk.text, plain.text);
  const moved = await call("POST", `/cards/${acmeTodo.id}/move?board=LOCAL`, {
    column: "parked",
  });
  assert.equal(moved.status, 204, moved.text);
  assert.equal(store.getCard(acmeTodo.id)?.column, "parked");
  assert.equal(store.getCard(acmeTodo.id)?.boardKey, "ACME");
  await store.moveCardManual(acmeTodo.id, "todo");
});

test("a group on ACME takes ACME members and refuses a member of another board", async () => {
  const workspace = {
    folder: acmeFolder,
    repos: [{ path: path.join(acmeFolder, "repo"), base: "main" }],
  };
  const m1 = await store.createLocalCard(ACME, "member one", "");
  const m2 = await store.createLocalCard(ACME, "member two", "");
  const stranger = await store.createLocalCard(LOCAL, "stranger", "");
  const cardsBefore = store.listCards(ALL_BOARDS).length;
  const refused = await call("POST", "/cards/group?board=ACME", {
    title: "mixed",
    memberIds: [m1.id, stranger.id],
    ...workspace,
  });
  assert.equal(refused.status, 409, refused.text);
  assert.deepEqual(refused.json, {
    error: "some selected cards are no longer eligible to be grouped",
    ineligibleIds: [stranger.id],
  });
  assert.equal(store.listCards(ALL_BOARDS).length, cardsBefore);
  assert.equal(store.getCard(m1.id)?.groupId, undefined);
  assert.equal(store.getCard(stranger.id)?.groupId, undefined);

  const reverse = await call("POST", "/cards/group", {
    title: "mixed",
    memberIds: [m2.id, stranger.id],
    ...workspace,
  });
  assert.equal(reverse.status, 409, reverse.text);
  assert.deepEqual(
    (reverse.json as { ineligibleIds: string[] }).ineligibleIds,
    [m2.id],
  );

  const created = await call("POST", "/cards/group?board=ACME", {
    title: "acme group",
    memberIds: [m1.id, m2.id],
    ...workspace,
  });
  assert.equal(created.status, 202, created.text);
  const card = (created.json as { card: { id: string; boardKey: string } })
    .card;
  assert.match(card.id, /^ACME-\d+$/);
  assert.equal(card.boardKey, "ACME");
  await waitFor(
    () => Promise.resolve(store.getCard(card.id)?.provisioningStep == null),
    10_000,
    "the group start saga to settle",
  );
});

test("item promote lands on the board named and refuses an item that sits on another board", async () => {
  await store.upsertItems("fake", [fakeItem("p1"), fakeItem("p2")], {
    kind: "snapshot",
  });
  const promoted = await call("POST", "/items/fake:p1/promote?board=ACME", {});
  assert.equal(promoted.status, 201, promoted.text);
  const card = (promoted.json as { card: { id: string; boardKey: string } })
    .card;
  assert.match(card.id, /^ACME-\d+$/);
  assert.equal(card.boardKey, "ACME");

  const again = await call("POST", "/items/fake:p1/promote?board=ACME", {});
  assert.equal(again.status, 200, again.text);
  assert.equal((again.json as { card: { id: string } }).card.id, card.id);

  const before = store.listCards(ALL_BOARDS).length;
  const other = await call("POST", "/items/fake:p1/promote", {});
  assert.equal(other.status, 409, other.text);
  assert.deepEqual(other.json, { error: "item is promoted" });
  assert.equal(store.listCards(ALL_BOARDS).length, before);

  const onLocal = await call("POST", "/items/fake:p2/promote", {});
  assert.equal(onLocal.status, 201, onLocal.text);
  assert.match(
    (onLocal.json as { card: { id: string } }).card.id,
    /^LOCAL-\d+$/,
  );
});

test("a group create and an item promote answer 409 board-archived when the board is archived after the check", async (t: TestContext) => {
  const GRPB = key("GRPB");
  const PROB = key("PROB");
  for (const [board, name] of [
    [GRPB, "Grp"],
    [PROB, "Pro"],
  ] as const) {
    await store.createBoard({
      key: board,
      name,
      workspaceRoot: path.join(env.root, "sessions", name),
      repositories: [
        {
          path: path.join(acmeFolder, "repo"),
          baseBranch: "main",
          checkCommand: "npm run check",
        },
      ],
      linearTeamKeys: [],
    });
  }
  const createGroupCard = store.createGroupCard.bind(store);
  t.mock.method(
    store,
    "createGroupCard",
    async (...args: Parameters<typeof createGroupCard>) => {
      await store.setBoardArchived(GRPB, true);
      return createGroupCard(...args);
    },
  );
  const promoteItem = store.promoteItem.bind(store);
  t.mock.method(
    store,
    "promoteItem",
    async (...args: Parameters<typeof promoteItem>) => {
      await store.setBoardArchived(PROB, true);
      return promoteItem(...args);
    },
  );

  const m1 = await store.createLocalCard(GRPB, "race one", "");
  const m2 = await store.createLocalCard(GRPB, "race two", "");
  const group = await call("POST", "/cards/group?board=GRPB", {
    title: "race group",
    memberIds: [m1.id, m2.id],
    folder: acmeFolder,
    repos: [{ path: path.join(acmeFolder, "repo"), base: "main" }],
  });
  assert.equal(group.status, 409, group.text);
  assert.deepEqual(group.json, {
    error: "board-archived",
    code: "board-archived",
  });
  assert.equal(store.getBoard(GRPB)?.archived, true);
  assert.equal(store.listCards(GRPB).length, 2);
  assert.equal(store.getCard(m1.id)?.groupId, undefined);
  assert.equal(store.getCard(m2.id)?.groupId, undefined);

  await store.upsertItems("fake", [fakeItem("p3")], { kind: "append" });
  const promoted = await call("POST", "/items/fake:p3/promote?board=PROB", {});
  assert.equal(promoted.status, 409, promoted.text);
  assert.deepEqual(promoted.json, {
    error: "board-archived",
    code: "board-archived",
  });
  assert.equal(store.getBoard(PROB)?.archived, true);
  assert.equal(store.listCards(PROB).length, 0);
});
