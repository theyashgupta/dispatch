import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, afterEach, test, type TestContext } from "node:test";
import type { Server } from "node:http";
import type { Card, Config } from "../../shared/types.js";
import { isolateEnv, waitFor } from "../test-support/fixtures.js";
import { issue } from "../test-support/fake-source.js";
import {
  linearFixture,
  queueLinearFetch,
  restoreFetch,
} from "../test-support/linear-fetch.js";
import { DEFAULT_BOARD_KEY } from "../../shared/board-key.js";

const env = isolateEnv();
fs.writeFileSync(
  path.join(env.binDir, "claude"),
  '#!/bin/sh\n[ "$CARDS_STUB" = hold ] && exec sleep 30\nexit 1\n',
  { mode: 0o755 },
);
fs.writeFileSync(path.join(env.binDir, "code"), "#!/bin/sh\nexit 0\n", {
  mode: 0o755,
});
const { store } = await import("../store/board.store.js");
const { rebuildSources } = await import("../adapters/source-gateway.js");
const { stopPollers } = await import("../adapters/poller.js");
const { resolveEditors } = await import("../adapters/editors.js");
const { invalidateWorkflow } =
  await import("../services/orchestration/linear-outbound.js");
const { setOrchestrationConfig } =
  await import("../services/infra/config-holder.js");
const { sessionStarter } =
  await import("../services/orchestration/start-session.js");
const { ATTACHMENTS_DIR } = await import("../services/infra/paths.js");
const express = (await import("express")).default;
const { cardsRouter } = await import("./cards.route.js");
const { httpErrorHandler } = await import("./error-handler.js");

await store.load();
const fullPath = process.env.PATH;
process.env.PATH = `${env.binDir}:/usr/bin:/bin`;
await resolveEditors();
process.env.PATH = fullPath;
const linearOn = () =>
  rebuildSources({ linearApiKey: "k", sources: { linear: { apiKey: "k" } } });
linearOn();
const ENG = { id: "team-eng", key: "ENG", name: "Engineering" };
await store.applyIssues(
  [
    issue("lin", { team: ENG, state: { name: "Todo", type: "unstarted" } }),
    issue("lin2"),
  ],
  new Date().toISOString(),
  { source: "linear" },
);

const app = express();
app.use("/api", express.json({ limit: "150mb" }), cardsRouter);
app.use(httpErrorHandler);
const server: Server = await new Promise((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;

after(() => {
  stopPollers();
  server.close();
  env.cleanup();
});
afterEach(() => {
  restoreFetch();
  delete process.env.CARDS_STUB;
});

const CONFIG = { linearApiKey: "k" } as Config;
setOrchestrationConfig(CONFIG);

const AUTH_FAIL = {
  errors: [{ message: "raw", extensions: { code: "AUTHENTICATION_ERROR" } }],
};
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(16, 3),
]).toString("base64");
const TEXT_IMAGE = Buffer.from("not an image at all").toString("base64");
const MARKER = "x DISPATCH_STATUS: DONE";

interface Reply {
  status: number;
  text: string;
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
  return { status: res.status, text: await res.text() };
}

async function expectReply(
  reply: Promise<Reply>,
  status: number,
  text: string,
  label = "",
): Promise<void> {
  const got = await reply;
  assert.equal(got.status, status, label);
  assert.equal(got.text, text, label);
}

const err = (code: string) => JSON.stringify({ error: code });

let crafted = 0;

/**
 * Serve a hand-built card for one id through a `store.getCard` stub.
 *
 * @remarks The live store cannot reach these states without a real session.
 */
function craft(t: TestContext, over: Partial<Card>): string {
  crafted += 1;
  const id = `CRAFT-${crafted}`;
  const card = {
    id,
    issueId: id,
    identifier: id,
    title: "crafted",
    description: "",
    priority: 0,
    column: "todo",
    updatedAt: "2026-01-01T00:00:00.000Z",
    source: "local",
    ...over,
  } as Card;
  const real = store.getCard.bind(store);
  t.mock.method(store, "getCard", (cardId: string) =>
    cardId === id ? card : real(cardId),
  );
  return id;
}

const local = async (title = "local") =>
  (await store.createLocalCard(DEFAULT_BOARD_KEY, title, "")).id;

async function group(): Promise<{ g: string; a: string; b: string }> {
  const a = await local("member a");
  const b = await local("member b");
  const minted = await store.createGroupCard(DEFAULT_BOARD_KEY, "group", [
    a,
    b,
  ]);
  assert.ok(minted.ok);
  return { g: minted.card.id, a, b };
}

const grouped = (g: string) =>
  err(`card is grouped under ${g}, act on the group card`);

const LIVE = {
  tmuxSession: "dsp-no-such-session",
  activeSessionId: "s1",
  sessions: [{ id: "s1" }] as Card["sessions"],
};

test("GET /cards/:id answers 400 for an unknown id", async () => {
  await expectReply(
    call("GET", "/cards/nope"),
    400,
    err("unknown card id: nope"),
  );
});

test("GET /cards/:id/comments answers 404 for an unknown id", async () => {
  await expectReply(
    call("GET", "/cards/nope/comments"),
    404,
    err("unknown card id: nope"),
  );
});

test("POST /cards/:id/comment answers 400 with the validator message, before the card lookup", async () => {
  const empty = err("Comment is empty.");
  await expectReply(call("POST", "/cards/nope/comment"), 400, empty);
  for (const body of [{}, [], { body: 5 }, { body: "  " }, { body: null }]) {
    await expectReply(
      call("POST", "/cards/nope/comment", body),
      400,
      empty,
      JSON.stringify(body),
    );
  }
  await expectReply(
    call("POST", "/cards/nope/comment", { body: "a".repeat(20001) }),
    400,
    err("Comment is longer than 20000 characters."),
  );
  await expectReply(
    call("POST", "/cards/nope/comment", {
      body: `${MARKER}${"a".repeat(20001)}`,
    }),
    400,
    err("Comment is longer than 20000 characters."),
  );
  await expectReply(
    call("POST", "/cards/nope/comment", { body: MARKER }),
    400,
    err("Comment cannot contain DISPATCH_STATUS:."),
  );
});

test("POST /cards/:id/comment answers the outcome status for 404, 409 and 502", async () => {
  await expectReply(
    call("POST", "/cards/nope/comment", { body: "hi" }),
    404,
    err("unknown card id: nope"),
  );
  await expectReply(
    call("POST", `/cards/${await local()}/comment`, { body: "hi" }),
    409,
    err("source cannot comment"),
  );
  queueLinearFetch([[401, AUTH_FAIL]]);
  await expectReply(
    call("POST", "/cards/lin2/comment", { body: "hi" }),
    502,
    err("Linear rejected the API key. Check it in Settings."),
  );
});

test("POST /cards/:id/assign-me answers the outcome status for 404, 409 and 502", async () => {
  await expectReply(
    call("POST", "/cards/nope/assign-me"),
    404,
    err("unknown card id: nope"),
  );
  await expectReply(
    call("POST", `/cards/${await local()}/assign-me`),
    409,
    err("source cannot assign"),
  );
  queueLinearFetch([[401, AUTH_FAIL]]);
  await expectReply(
    call("POST", "/cards/lin2/assign-me"),
    502,
    err("Linear rejected the API key. Check it in Settings."),
  );
});

test("POST /cards/:id/linear-state answers 400 for a bad stateId, before the card lookup", async () => {
  const text = err("stateId must be a string of 1 to 200 characters");
  await expectReply(call("POST", "/cards/nope/linear-state"), 400, text);
  for (const body of [
    {},
    [],
    { stateId: 7 },
    { stateId: "" },
    { stateId: null },
    { stateId: "s".repeat(201) },
  ]) {
    await expectReply(
      call("POST", "/cards/nope/linear-state", body),
      400,
      text,
      JSON.stringify(body).slice(0, 40),
    );
  }
});

test("POST /cards/:id/linear-state answers the outcome status for 404, 409, 400 and 502", async () => {
  await expectReply(
    call("POST", "/cards/nope/linear-state", { stateId: "s".repeat(200) }),
    404,
    err("unknown card id: nope"),
  );
  await expectReply(
    call("POST", `/cards/${await local()}/linear-state`, { stateId: "x" }),
    409,
    err("only a Linear card with a team has Linear states"),
  );
  await expectReply(
    call("POST", "/cards/lin2/linear-state", { stateId: "x" }),
    409,
    err("only a Linear card with a team has Linear states"),
  );
  rebuildSources({
    linearApiKey: "k",
    sources: { linear: { apiKey: "k", enabled: false } },
  });
  try {
    await expectReply(
      call("POST", "/cards/lin/linear-state", { stateId: "x" }),
      409,
      err("Linear is not connected"),
    );
  } finally {
    linearOn();
  }
  invalidateWorkflow();
  queueLinearFetch([[200, linearFixture("workflow.json")]]);
  await expectReply(
    call("POST", "/cards/lin/linear-state", { stateId: "x-done" }),
    400,
    err("stateId is not a state of the card's team"),
  );
  invalidateWorkflow();
  queueLinearFetch([[401, AUTH_FAIL]]);
  await expectReply(
    call("POST", "/cards/lin/linear-state", { stateId: "st-backlog" }),
    502,
    err(
      "Linear state not updated. Linear rejected the API key. Check it in Settings.",
    ),
  );
  invalidateWorkflow();
});

const COLUMN_ERROR = err(
  "invalid column; must be one of: todo, in_progress, needs_input, agent_done, in_review, parked, done, inbox",
);

test("POST /cards/:id/move answers 400 for a bad column, before the card lookup", async () => {
  await expectReply(call("POST", "/cards/nope/move"), 400, COLUMN_ERROR);
  for (const body of [
    {},
    [],
    { column: 5 },
    { column: "nope" },
    { column: "INBOX" },
    { column: null },
    { column: ["todo"] },
  ]) {
    await expectReply(
      call("POST", "/cards/nope/move", body),
      400,
      COLUMN_ERROR,
      JSON.stringify(body),
    );
  }
  await expectReply(
    call("POST", "/cards/nope/move", { column: "todo" }),
    400,
    err("unknown card id: nope"),
  );
});

test("POST /cards/:id/move answers 409 for a grouped member before any transition rule", async () => {
  const { g, a } = await group();
  await expectReply(
    call("POST", `/cards/${a}/move`, { column: "agent_done" }),
    409,
    grouped(g),
  );
  await expectReply(
    call("POST", `/cards/${a}/move`, { column: "inbox" }),
    409,
    grouped(g),
  );
});

test("POST /cards/:id/move answers 409 for each inbox transition rule", async (t) => {
  await expectReply(
    call("POST", `/cards/${craft(t, { column: "inbox" })}/move`, {
      column: "in_progress",
    }),
    409,
    err("inbox cards can only be promoted to To Do"),
  );
  await expectReply(
    call("POST", `/cards/${craft(t, { column: "in_progress" })}/move`, {
      column: "inbox",
    }),
    409,
    err("only To Do cards can be moved to Inbox"),
  );
  const starting = await local("starting");
  store.beginStart(starting);
  try {
    await expectReply(
      call("POST", `/cards/${starting}/move`, { column: "inbox" }),
      409,
      err("a start is in flight for this card"),
    );
  } finally {
    store.endStart(starting);
  }
  await expectReply(
    call("POST", `/cards/${craft(t, { branch: "b" })}/move`, {
      column: "inbox",
    }),
    409,
    err("cards with session history cannot be moved to Inbox"),
  );
});

test("POST /cards/:id/move answers 409 for a blocked manual transition", async () => {
  const id = await local("manual");
  await expectReply(
    call("POST", `/cards/${id}/move`, { column: "agent_done" }),
    409,
    err(
      "Agent Done is set automatically by a real agent completion signal. It is never a manual move target",
    ),
  );
  await expectReply(
    call("POST", `/cards/${id}/move`, { column: "in_progress" }),
    409,
    err(
      "starting a To Do card requires the start flow: drag it to In Progress (or use Start) rather than posting a bare move",
    ),
  );
});

test("POST /cards/:id/start answers 400 and 409 for the card guards in order", async (t) => {
  await expectReply(
    call("POST", "/cards/nope/start", { newSession: true }),
    400,
    err("unknown card id: nope"),
  );
  const { g, a } = await group();
  await expectReply(call("POST", `/cards/${a}/start`), 409, grouped(g));
  await expectReply(
    call(
      "POST",
      `/cards/${craft(t, { column: "done", identifier: "bad id" })}/start`,
    ),
    409,
    err("cannot start a session for a Done card"),
  );
  await expectReply(
    call(
      "POST",
      `/cards/${craft(t, { column: "inbox", identifier: "bad id" })}/start`,
    ),
    409,
    err("cannot start a session from the Inbox: promote to To Do first"),
  );
  await expectReply(
    call("POST", `/cards/${craft(t, { identifier: "bad id" })}/start`, {
      newSession: true,
    }),
    400,
    err("invalid ticket identifier: bad id"),
  );
});

test("POST /cards/:id/start answers 409 for the session and inheritance guards", async (t) => {
  const id = await local("fresh");
  await expectReply(
    call("POST", `/cards/${id}/start`, { newSession: true }),
    409,
    err("no existing session to start another from"),
  );
  await expectReply(
    call("POST", `/cards/${id}/start`, {
      newSession: true,
      inheritFrom: "s1",
    }),
    409,
    err("no existing session to start another from"),
  );
  await expectReply(
    call("POST", `/cards/${id}/start`, { inheritFrom: "s1" }),
    409,
    err("inheritance requires a new session"),
  );
  await expectReply(
    call("POST", `/cards/${id}/start`, {
      newSession: "yes",
      inheritFrom: "s1",
    }),
    409,
    err("inheritance requires a new session"),
  );
  const live = craft(t, LIVE);
  await expectReply(
    call("POST", `/cards/${live}/start`, {
      newSession: true,
      inheritFrom: "s2",
    }),
    409,
    err("unknown session to inherit from"),
  );
});

test("POST /cards/:id/start answers 400 for the config, playbook and workspace checks in order", async () => {
  const id = await local("start checks");
  setOrchestrationConfig(null as unknown as Config);
  try {
    await expectReply(
      call("POST", `/cards/${id}/start`, {
        playbook: "nope",
        folder: "/x",
        repos: [{ path: "/x", base: "-x" }],
      }),
      400,
      '{"error":"orchestration config is not loaded","variant":"config"}',
    );
  } finally {
    setOrchestrationConfig(CONFIG);
  }
  await expectReply(
    call("POST", `/cards/${id}/start`, {
      playbook: "nope",
      folder: "/x",
      repos: [{ path: "/x", base: "-x" }],
    }),
    400,
    '{"error":"unknown playbook","variant":"playbook"}',
  );
  await expectReply(
    call("POST", `/cards/${id}/start`, {
      playbook: 5,
      folder: "/x",
      repos: [
        { path: "/nope-a", base: "main" },
        { path: "/x", base: "-x" },
      ],
    }),
    400,
    '{"error":"invalid base branch","variant":"config"}',
  );
  await expectReply(
    call("POST", `/cards/${id}/start`, {
      folder: "/x",
      repos: [{ path: "/nope-a", base: "main" }],
    }),
    400,
    '{"error":"Can\'t start: a selected repo is missing","variant":"config"}',
  );
  const none =
    '{"error":"No workspace selected for this ticket","variant":"config"}';
  for (const body of [
    undefined,
    [],
    { folder: "/x" },
    { folder: "/x", repos: [] },
    { folder: 5, repos: [{ path: "/x", base: "-x" }] },
    { folder: "/x", repos: [null] },
    { folder: "/x", repos: [["a"]] },
    { folder: "/x", repos: [{ path: "/x" }] },
    { folder: "/x", repos: [{ path: "/x", base: 5 }] },
    { folder: "/x", repos: "a" },
  ]) {
    await expectReply(
      call("POST", `/cards/${id}/start`, body),
      400,
      none,
      JSON.stringify(body),
    );
  }
});

test("POST /cards/:id/start answers 409 while a session start is in progress and starts once", async (t) => {
  const id = await local("start twice");
  const repo = path.join(env.binDir, "start-twice-repo");
  fs.mkdirSync(path.join(repo, ".git"), { recursive: true });
  const start = t.mock.method(sessionStarter, "start", (cardId: string) => {
    store.beginStart(cardId);
    return Promise.resolve();
  });
  const body = { folder: env.binDir, repos: [{ path: repo, base: "main" }] };
  try {
    await expectReply(
      call("POST", `/cards/${id}/start`, body),
      202,
      '{"started":true}',
    );
    await expectReply(
      call("POST", `/cards/${id}/start`, body),
      409,
      err("a session start is already in progress"),
    );
    assert.equal(start.mock.callCount(), 1);
  } finally {
    store.endStart(id);
  }
});

test("POST /cards/:id/resume answers each guard in order", async (t) => {
  await expectReply(
    call("POST", "/cards/nope/resume"),
    400,
    err("unknown card id: nope"),
  );
  const { g, a } = await group();
  await expectReply(call("POST", `/cards/${a}/resume`), 409, grouped(g));
  await expectReply(
    call(
      "POST",
      `/cards/${craft(t, { identifier: "bad id", tmuxSession: "x" })}/resume`,
    ),
    400,
    err("invalid ticket identifier: bad id"),
  );
  await expectReply(
    call("POST", `/cards/${craft(t, { tmuxSession: "x" })}/resume`),
    400,
    err("card has no workspace to resume"),
  );
  await expectReply(
    call(
      "POST",
      `/cards/${craft(t, { workspacePath: "/w", tmuxSession: "x" })}/resume`,
    ),
    409,
    err("session is already live"),
  );
  await expectReply(
    call("POST", `/cards/${craft(t, { workspacePath: "/w" })}/resume`),
    409,
    err("card has no lost session to resume"),
  );
  const lost = craft(t, { workspacePath: "/w", sessionLost: true });
  store.beginStart(lost);
  try {
    await expectReply(
      call("POST", `/cards/${lost}/resume`),
      409,
      err("a start is in flight for this card"),
    );
  } finally {
    store.endStart(lost);
  }
});

test("POST /cards/:id/terminal answers each guard in order", async (t) => {
  await expectReply(
    call("POST", "/cards/nope/terminal"),
    400,
    err("unknown card id: nope"),
  );
  const { g, a } = await group();
  await expectReply(call("POST", `/cards/${a}/terminal`), 409, grouped(g));
  await expectReply(
    call(
      "POST",
      `/cards/${craft(t, { identifier: "bad id", tmuxSession: "x" })}/terminal`,
    ),
    400,
    err("card has no live session"),
  );
  await expectReply(
    call(
      "POST",
      `/cards/${craft(t, { ...LIVE, identifier: "bad id" })}/terminal`,
    ),
    400,
    err("invalid ticket identifier: bad id"),
  );
});

test("POST /cards/:id/run-claude answers each guard and outcome reachable without tmux", async (t) => {
  await expectReply(
    call("POST", "/cards/nope/run-claude"),
    400,
    err("unknown card id: nope"),
  );
  const { g, a } = await group();
  await expectReply(call("POST", `/cards/${a}/run-claude`), 409, grouped(g));
  await expectReply(
    call("POST", `/cards/${craft(t, { activeSessionId: "s1" })}/run-claude`),
    400,
    err("card has no live session"),
  );
  const busy = craft(t, LIVE);
  store.beginStart(busy);
  try {
    await expectReply(
      call("POST", `/cards/${busy}/run-claude`),
      409,
      err("the terminal is not at a shell prompt"),
    );
  } finally {
    store.endStart(busy);
  }
  await expectReply(
    call("POST", `/cards/${busy}/run-claude`),
    400,
    err("card has no live session"),
  );
});

test("POST /cards/:id/session answers the card guards before the body checks", async (t) => {
  await expectReply(
    call("POST", "/cards/nope/session", { sessionId: 5 }),
    400,
    err("unknown card id: nope"),
  );
  const { g, a } = await group();
  await expectReply(
    call("POST", `/cards/${a}/session`, { sessionId: 5 }),
    409,
    grouped(g),
  );
  const id = craft(t, LIVE);
  for (const body of [undefined, {}, [], { sessionId: 5 }, { sessionId: "" }]) {
    await expectReply(
      call("POST", `/cards/${id}/session`, body),
      400,
      err("invalid sessionId"),
      JSON.stringify(body),
    );
  }
  await expectReply(
    call("POST", `/cards/${id}/session`, { sessionId: "s9" }),
    400,
    err("session s9 does not resolve for this card"),
  );
});

test("POST /cards/:id/open-editor answers the editor checks before the card guards", async (t) => {
  const bad = err("invalid editor; must be one of: code, cursor");
  for (const body of [undefined, {}, [], { editor: "vim" }, { editor: 5 }]) {
    await expectReply(
      call("POST", "/cards/nope/open-editor", body),
      400,
      bad,
      JSON.stringify(body),
    );
  }
  await expectReply(
    call("POST", "/cards/nope/open-editor", { editor: "cursor" }),
    400,
    err('editor "cursor" is not available'),
  );
  await expectReply(
    call("POST", "/cards/nope/open-editor", { editor: "code" }),
    400,
    err("unknown card id: nope"),
  );
  const { g, a } = await group();
  await expectReply(
    call("POST", `/cards/${a}/open-editor`, { editor: "code" }),
    409,
    grouped(g),
  );
  await expectReply(
    call("POST", `/cards/${craft(t, {})}/open-editor`, { editor: "code" }),
    400,
    err("card has no workspace"),
  );
});

test("POST /cards/:id/cleanup answers each guard in order", async (t) => {
  await expectReply(
    call("POST", "/cards/nope/cleanup"),
    400,
    err("unknown card id: nope"),
  );
  const { g, a } = await group();
  await expectReply(call("POST", `/cards/${a}/cleanup`), 409, grouped(g));
  await expectReply(
    call("POST", `/cards/${await local()}/cleanup`, { force: true }),
    409,
    err("cleanup is only available for Done cards"),
  );
  const done = craft(t, { column: "done" });
  store.beginStart(done);
  store.beginCleanup(done);
  try {
    await expectReply(
      call("POST", `/cards/${done}/cleanup`),
      409,
      err("a start is in flight for this card"),
    );
    store.endStart(done);
    await expectReply(
      call("POST", `/cards/${done}/cleanup`),
      409,
      err("cleanup is already in flight for this card"),
    );
  } finally {
    store.endStart(done);
    store.endCleanup(done);
  }
});

test("POST /cards/group answers 400 for the title and member checks in order", async () => {
  const title = err("invalid-title");
  const members = err("memberIds must be an array of >=2 distinct card ids");
  const marker = err("content contains the DISPATCH_STATUS marker");
  await expectReply(call("POST", "/cards/group"), 400, title);
  for (const body of [
    {},
    [],
    { title: 5, memberIds: [] },
    { title: "   " },
    { title: "t".repeat(301) },
    { title: null },
  ]) {
    await expectReply(
      call("POST", "/cards/group", body),
      400,
      title,
      JSON.stringify(body).slice(0, 40),
    );
  }
  await expectReply(
    call("POST", "/cards/group", { title: MARKER }),
    400,
    marker,
  );
  for (const memberIds of [
    undefined,
    "a,b",
    [],
    ["a"],
    ["a", 5],
    ["a", "a"],
    [null, null],
  ]) {
    await expectReply(
      call("POST", "/cards/group", {
        title: ` ${"t".repeat(300)} `,
        memberIds,
      }),
      400,
      members,
      JSON.stringify(memberIds),
    );
  }
});

test("POST /cards/group answers 409 with every ineligible id, then the config, playbook and workspace checks", async () => {
  const a = await local("ga");
  const b = await local("gb");
  const { g, a: member } = await group();
  await expectReply(
    call("POST", "/cards/group", {
      title: "grp",
      memberIds: ["ghost", a, member, g],
      playbook: "nope",
    }),
    409,
    `{"error":"some selected cards are no longer eligible to be grouped","ineligibleIds":["ghost","${member}","${g}"]}`,
  );
  setOrchestrationConfig(null as unknown as Config);
  try {
    await expectReply(
      call("POST", "/cards/group", {
        title: "grp",
        memberIds: [a, b],
        playbook: "nope",
      }),
      400,
      '{"error":"orchestration config is not loaded","variant":"config"}',
    );
  } finally {
    setOrchestrationConfig(CONFIG);
  }
  await expectReply(
    call("POST", "/cards/group", {
      title: "grp",
      memberIds: [a, b],
      playbook: "nope",
    }),
    400,
    '{"error":"unknown playbook","variant":"playbook"}',
  );
  const none =
    '{"error":"No workspace selected for this group","variant":"config"}';
  for (const extra of [
    {},
    { folder: "/x" },
    { folder: "/x", repos: [] },
    { folder: 5, repos: [{ path: "/x", base: "main" }] },
    { folder: "/x", repos: [{ path: "/x" }] },
    { folder: "/x", repos: [null] },
  ]) {
    await expectReply(
      call("POST", "/cards/group", {
        title: "grp",
        memberIds: [a, b],
        ...extra,
      }),
      400,
      none,
      JSON.stringify(extra),
    );
  }
  await expectReply(
    call("POST", "/cards/group", {
      title: "grp",
      memberIds: [a, b],
      folder: "/x",
      repos: [
        { path: "/nope-a", base: "main" },
        { path: "/x", base: "-x" },
      ],
    }),
    400,
    '{"error":"invalid base branch","variant":"config"}',
  );
  await expectReply(
    call("POST", "/cards/group", {
      title: "grp",
      memberIds: [a, b],
      folder: "/x",
      repos: [{ path: "/nope-a", base: "main" }],
    }),
    400,
    '{"error":"Can\'t start: a selected repo is missing","variant":"config"}',
  );
});

test("POST /cards/group answers 409 when the store refuses the mint", async (t) => {
  const a = await local("ra");
  const b = await local("rb");
  const repo = path.join(env.root, "fake-repo");
  fs.mkdirSync(path.join(repo, ".git"), { recursive: true });
  t.mock.method(store, "createGroupCard", () =>
    Promise.resolve({ ok: false, ineligibleIds: [b] }),
  );
  await expectReply(
    call("POST", "/cards/group", {
      title: "race",
      memberIds: [a, b],
      folder: repo,
      repos: [{ path: repo, base: "main" }],
    }),
    409,
    `{"error":"some selected cards are no longer eligible to be grouped","ineligibleIds":["${b}"]}`,
  );
});

test("POST /cards/:id/unwind answers 400 for a bad destination, then the outcome status", async (t) => {
  const bad = err("to must be todo or inbox");
  for (const body of [{ to: "x" }, { to: null }, { to: 5 }, { to: "" }]) {
    await expectReply(
      call("POST", "/cards/nope/unwind", body),
      400,
      bad,
      JSON.stringify(body),
    );
  }
  await expectReply(
    call("POST", "/cards/nope/unwind"),
    404,
    err("unknown card id: nope"),
  );
  await expectReply(
    call("POST", "/cards/nope/unwind", []),
    404,
    err("unknown card id: nope"),
  );
  await expectReply(
    call("POST", `/cards/${await local()}/unwind`, { to: "inbox" }),
    409,
    err("only a group can be unwound"),
  );
  const { g, a } = await group();
  store.beginStart(g);
  try {
    await expectReply(
      call("POST", `/cards/${a}/unwind`),
      409,
      err("a start or resume is in flight for this group"),
    );
  } finally {
    store.endStart(g);
  }
  store.beginCleanup(g);
  try {
    await expectReply(
      call("POST", `/cards/${g}/unwind`),
      409,
      err("cleanup is in flight for this group"),
    );
  } finally {
    store.endCleanup(g);
  }
  t.mock.method(store, "unwindGroup", () =>
    Promise.resolve({ ok: false, reason: "a start or resume is in flight" }),
  );
  await expectReply(
    call("POST", `/cards/${g}/unwind`, { to: "todo" }),
    409,
    err("a start or resume is in flight"),
  );
});

test("POST /cards/:id/reset answers the outcome status for 404, 409 and 500", async (t) => {
  await expectReply(
    call("POST", "/cards/nope/reset"),
    404,
    err("unknown card id: nope"),
  );
  const { g, a } = await group();
  await expectReply(
    call("POST", `/cards/${g}/reset`),
    409,
    err("unwind the group instead"),
  );
  await expectReply(
    call("POST", `/cards/${a}/reset`),
    409,
    err("unwind the group instead"),
  );
  await expectReply(
    call("POST", `/cards/${await local()}/reset`),
    409,
    err("nothing to reset: no session or workspace is attached"),
  );
  const started = craft(t, { branch: "b1" });
  store.beginStart(started);
  try {
    await expectReply(
      call("POST", `/cards/${started}/reset`),
      409,
      err("a start or resume is in flight for this card"),
    );
  } finally {
    store.endStart(started);
  }
  store.beginCleanup(started);
  try {
    await expectReply(
      call("POST", `/cards/${started}/reset`),
      409,
      err("cleanup is in flight for this card"),
    );
  } finally {
    store.endCleanup(started);
  }
  const locked = path.join(env.root, "locked");
  const workspacePath = path.join(locked, "ws");
  fs.mkdirSync(workspacePath, { recursive: true });
  fs.chmodSync(locked, 0o500);
  try {
    await expectReply(
      call("POST", `/cards/${craft(t, { workspacePath })}/reset`),
      500,
      err(
        "Reset stopped while deleting the workspace (workspace folder). Run Reset again.",
      ),
    );
  } finally {
    fs.chmodSync(locked, 0o700);
  }
});

test("POST /cards/draft answers 400 for the direction and image checks in order", async () => {
  const direction = err("invalid-direction");
  const images = err("invalid-images");
  await expectReply(call("POST", "/cards/draft"), 400, direction);
  for (const body of [
    {},
    [],
    { direction: 5 },
    { direction: "  " },
    { direction: "d".repeat(10001), images: "x" },
    { direction: null, images: [TEXT_IMAGE] },
  ]) {
    await expectReply(
      call("POST", "/cards/draft", body),
      400,
      direction,
      JSON.stringify(body).slice(0, 40),
    );
  }
  for (const bad of [
    "x",
    null,
    [5],
    [TEXT_IMAGE],
    [""],
    Array.from({ length: 11 }, () => PNG),
  ]) {
    await expectReply(
      call("POST", "/cards/draft", {
        direction: ` ${"d".repeat(10000)} `,
        images: bad,
      }),
      400,
      images,
      JSON.stringify(bad).slice(0, 40),
    );
  }
});

test("POST /cards/draft answers 409 while a draft is in flight and 502 when generation fails", async () => {
  process.env.CARDS_STUB = "hold";
  const held = new AbortController();
  const first = fetch(`${base}/cards/draft`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ direction: "first" }),
    signal: held.signal,
  }).catch(() => undefined);
  await new Promise((r) => setTimeout(r, 300));
  await expectReply(
    call("POST", "/cards/draft", { direction: "second" }),
    409,
    err("generate-in-progress"),
  );
  await expectReply(
    call("POST", "/cards/draft", { direction: "", images: "x" }),
    400,
    err("invalid-direction"),
  );
  await expectReply(
    call("POST", "/cards/draft", { direction: "third", images: "x" }),
    400,
    err("invalid-images"),
  );
  delete process.env.CARDS_STUB;
  held.abort();
  await first;
  let last: Reply = { status: 0, text: "" };
  await waitFor(
    async () => {
      last = await call("POST", "/cards/draft", { direction: "after" });
      return last.status !== 409;
    },
    10_000,
    "the held draft to release its slot",
  );
  assert.equal(last.status, 502);
  assert.equal(last.text, err("generate-failed"));
});

test("POST /cards/group-title answers 400 for bad member ids", async () => {
  const text = err("invalid-member-ids");
  await expectReply(call("POST", "/cards/group-title"), 400, text);
  const a = await local("ta");
  for (const memberIds of [
    undefined,
    "a,b",
    [],
    [a],
    [a, 5],
    [a, a],
    Array.from({ length: 51 }, (_, i) => `id-${i}`),
    [a, "ghost"],
    ["ghost", "phantom"],
  ]) {
    await expectReply(
      call("POST", "/cards/group-title", { memberIds }),
      400,
      text,
      String(JSON.stringify(memberIds)).slice(0, 40),
    );
  }
  await expectReply(call("POST", "/cards/group-title", []), 400, text);
});

test("POST /cards/group-title answers 409 for another member set in flight and 502 when generation fails", async () => {
  const a = await local("ta");
  const b = await local("tb");
  const c = await local("tc");
  process.env.CARDS_STUB = "hold";
  const held = new AbortController();
  const first = fetch(`${base}/cards/group-title`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ memberIds: [a, b] }),
    signal: held.signal,
  }).catch(() => undefined);
  await new Promise((r) => setTimeout(r, 300));
  await expectReply(
    call("POST", "/cards/group-title", { memberIds: [a, c] }),
    409,
    err("generate-in-progress"),
  );
  await expectReply(
    call("POST", "/cards/group-title", { memberIds: [a] }),
    400,
    err("invalid-member-ids"),
  );
  delete process.env.CARDS_STUB;
  held.abort();
  await first;
  let last: Reply = { status: 0, text: "" };
  await waitFor(
    async () => {
      last = await call("POST", "/cards/group-title", { memberIds: [a, c] });
      return last.status !== 409;
    },
    10_000,
    "the held title run to release its slot",
  );
  assert.equal(last.status, 502);
  assert.equal(last.text, err("generate-failed"));
});

test("POST /cards answers 400 for each field check in order", async () => {
  const title = err("invalid-title");
  const description = err("invalid-description");
  const marker = err("content contains the DISPATCH_STATUS marker");
  const images = err("invalid-images");
  await expectReply(call("POST", "/cards"), 400, title);
  for (const body of [
    {},
    [],
    { title: 5, description: "d" },
    { title: " ", description: "d" },
    { title: "t".repeat(301), description: "d" },
  ]) {
    await expectReply(
      call("POST", "/cards", body),
      400,
      title,
      JSON.stringify(body).slice(0, 40),
    );
  }
  for (const body of [
    { title: MARKER },
    { title: MARKER, description: 5 },
    { title: "t", description: "  " },
    { title: MARKER, description: "d".repeat(20001) },
  ]) {
    await expectReply(
      call("POST", "/cards", body),
      400,
      description,
      JSON.stringify(body).slice(0, 40),
    );
  }
  for (const body of [
    { title: MARKER, description: "d", images: "x" },
    { title: "t", description: MARKER, images: [TEXT_IMAGE] },
  ]) {
    await expectReply(
      call("POST", "/cards", body),
      400,
      marker,
      JSON.stringify(body).slice(0, 40),
    );
  }
  for (const bad of ["x", null, [5], [TEXT_IMAGE], {}]) {
    await expectReply(
      call("POST", "/cards", { title: "t", description: "d", images: bad }),
      400,
      images,
      JSON.stringify(bad).slice(0, 40),
    );
  }
  await expectReply(
    call("POST", "/cards", {
      title: "t",
      description: ` ${"d".repeat(19990)} `,
      images: [PNG],
    }),
    400,
    description,
  );
});

test("POST /cards answers 500 when staging or committing an attachment fails", async (t) => {
  fs.rmSync(ATTACHMENTS_DIR, { recursive: true, force: true });
  fs.writeFileSync(ATTACHMENTS_DIR, "not a folder");
  try {
    await expectReply(
      call("POST", "/cards", { title: "t", description: "d", images: [PNG] }),
      500,
      err("attachment-write-failed"),
    );
  } finally {
    fs.rmSync(ATTACHMENTS_DIR, { force: true });
  }
  const template = store.getCard(await local("template"))!;
  t.mock.method(store, "createLocalCard", () =>
    Promise.resolve({ ...template, id: "no-parent/child" }),
  );
  await expectReply(
    call("POST", "/cards", { title: "t", description: "d", images: [PNG] }),
    500,
    err("attachment-write-failed"),
  );
});

test("GET /cards/:id/attachments/:name answers 400 for bad params and 404 for a missing file", async () => {
  const bad = err("invalid-attachment");
  for (const route of [
    "/cards/a.b/attachments/0123456789abcdef.png",
    "/cards/LOCAL-1/attachments/x.png",
    "/cards/LOCAL-1/attachments/0123456789abcdef.svg",
    "/cards/LOCAL-1/attachments/..%2F0123456789abcdef.png",
    "/cards/a%20b/attachments/nope",
  ]) {
    await expectReply(call("GET", route), 400, bad, route);
  }
  await expectReply(
    call("GET", "/cards/LOCAL-1/attachments/0123456789abcdef.png"),
    404,
    err("not-found"),
  );
});

test("POST /cards/:id/sync-linear answers each guard in order, then 502 on a Linear failure", async () => {
  await expectReply(
    call("POST", "/cards/nope/sync-linear", {}),
    404,
    err("unknown card id: nope"),
  );
  const { g, a } = await group();
  await expectReply(
    call("POST", `/cards/${a}/sync-linear`, {}),
    409,
    grouped(g),
  );
  await expectReply(
    call("POST", "/cards/lin/sync-linear", { teamId: "team-eng" }),
    409,
    err("only local tickets can be synced to Linear"),
  );
  const id = await local("sync");
  store.beginSync(id);
  try {
    await expectReply(
      call("POST", `/cards/${id}/sync-linear`, {}),
      409,
      err("a sync is already in flight for this card"),
    );
  } finally {
    store.endSync(id);
  }
  for (const body of [undefined, {}, [], { teamId: 5 }, { teamId: "" }]) {
    await expectReply(
      call("POST", `/cards/${id}/sync-linear`, body),
      400,
      err("teamId is required"),
      JSON.stringify(body),
    );
  }
  rebuildSources({
    linearApiKey: "k",
    sources: { linear: { apiKey: "k", enabled: false } },
  });
  try {
    await expectReply(
      call("POST", `/cards/${id}/sync-linear`, { teamId: "team-eng" }),
      409,
      err("Linear is not connected"),
    );
  } finally {
    linearOn();
  }
  queueLinearFetch([[401, AUTH_FAIL]]);
  await expectReply(
    call("POST", `/cards/${id}/sync-linear`, {
      teamId: "team-eng",
      stateId: 5,
    }),
    502,
    err("sync-failed"),
  );
});
