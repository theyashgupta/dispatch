import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseSeedArgs } from "./seed-args.mjs";

const ENTRY = join(import.meta.dirname, "../../dist/server/bootstrap/index.js");

const { kind, port, now } = parseSeedArgs(process.argv.slice(2), process.env);

/**
 * Resolves when nothing listens on the loopback port, rejects when the port is taken.
 *
 * @remarks
 * The server silently falls back to a random port on EADDRINUSE, so a busy port must stop the run here.
 */
function assertPortFree() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", () => reject(new Error(`port ${port} is in use`)));
    probe.listen(port, "127.0.0.1", () => probe.close(resolve));
  });
}

/**
 * Throw when the real dispatch service answers on port 4700.
 *
 * @remarks
 * Server boot sweeps every unadopted dsp-ttyd process on the machine, so a run beside the live service would kill its terminals.
 */
async function assertNoLiveService() {
  try {
    const res = await fetch("http://127.0.0.1:4700/api/board");
    await res.body?.cancel().catch(() => {});
    throw new Error(
      "LIVE-SERVICE: a dispatch service answered on http://127.0.0.1:4700/api/board, refusing to boot the visual servers. Stop it first, then rerun.",
    );
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("LIVE-SERVICE"))
      throw err;
  }
}

/**
 * Start the built server on `dir` with the given stdio.
 *
 * @remarks
 * HOME points into the folder and the usage URL at a closed loopback port, so no account, usage or vault file of this machine reaches a screenshot and no usage request leaves it.
 * The darwin keychain is not isolated: the server still reads the Claude Code credential from it at boot.
 */
function boot(dir, stdio) {
  return spawn(process.execPath, [ENTRY], {
    env: {
      ...process.env,
      DISPATCH_DIR: dir,
      DISPATCH_USAGE_URL: "http://127.0.0.1:1",
      HOME: join(dir, "home"),
      NODE_ENV: "production",
    },
    stdio,
  });
}

/** Poll `/api/board` until it answers 200. */
async function waitReady() {
  const end = Date.now() + 30_000;
  while (Date.now() < end) {
    const res = await fetch(`http://127.0.0.1:${port}/api/board`).catch(
      () => null,
    );
    await res?.body?.cancel();
    if (res?.ok) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`server on ${port} not ready`);
}

const iso = (minutesAgo) => new Date(now - minutesAgo * 60_000).toISOString();

/** One board card with the fields every column view reads. */
function card(id, identifier, title, column, minutesAgo, extra = {}) {
  return {
    id,
    issueId: `${id}-issue`,
    identifier,
    title,
    description: `Description for ${title}.`,
    url: `https://linear.app/visual/issue/${identifier}`,
    project: { id: "proj-visual", name: "Visual Project" },
    linearState: {
      id: "st-todo",
      name: "Todo",
      type: "unstarted",
      color: "#888888",
    },
    priority: 2,
    column,
    source: "linear",
    updatedAt: iso(minutesAgo),
    ...extra,
  };
}

/** Card with one active session record and no tmux session behind it (U4-21). */
function withSession(c, dir) {
  const workspacePath = join(dir, "workspaces", c.identifier);
  mkdirSync(workspacePath, { recursive: true });
  const session = {
    id: `${c.id}-session`,
    createdAt: iso(180),
    updatedAt: iso(180),
    hookToken: "0".repeat(64),
    workspacePath,
    workspace: { folder: join(dir, "ws"), repos: [] },
    branch: `visual/${c.identifier.toLowerCase()}`,
  };
  return {
    ...c,
    sessions: [session],
    activeSessionId: session.id,
    hookToken: session.hookToken,
    workspacePath,
    workspace: session.workspace,
    branch: session.branch,
  };
}

/** One inbox item in the shape the source adapters write. */
function item(id, source, type, title, minutesAgo, meta) {
  return {
    id,
    source,
    type,
    title,
    snippet: `Snippet for ${title}.`,
    url: `https://example.com/${id}`,
    createdAt: iso(minutesAgo),
    priority: 50,
    state: "unread",
    meta,
  };
}

/** Write the board rows into the schema the warm boot created. */
function seedRows(dir) {
  const members = ["v-gm-1", "v-gm-2", "v-gm-3"];
  const cards = [
    card("v-todo", "VIS-101", "Todo ticket", "todo", 30),
    withSession(
      card(
        "v-prog",
        "VIS-102",
        "In progress ticket with a session",
        "in_progress",
        5,
      ),
      dir,
    ),
    card("v-need", "VIS-103", "Ticket that needs input", "needs_input", 8, {
      statusReason: "Waiting for an answer.",
    }),
    card("v-agent", "VIS-104", "Agent done ticket", "agent_done", 12, {
      statusReason: "Finished the refactor.",
    }),
    card("v-review", "VIS-105", "Ticket in review", "in_review", 90),
    card("v-park", "VIS-106", "Parked ticket", "parked", 300),
    card("v-done", "VIS-107", "Done ticket", "done", 600),
    card("v-inbox", "VIS-108", "Inbox ticket", "inbox", 20),
    {
      id: "GROUP-1",
      issueId: "GROUP-1",
      identifier: "GROUP-1",
      title: "Group of three",
      description: null,
      priority: 0,
      column: "todo",
      updatedAt: iso(40),
      source: "group",
      memberIds: members,
    },
    ...members.map((id, i) =>
      card(id, `VIS-11${i + 1}`, `Group member ${i + 1}`, "todo", 40, {
        groupId: "GROUP-1",
      }),
    ),
  ];
  const items = [
    item(
      "github:visual/app#7",
      "github",
      "pr_review",
      "Review the token rename",
      15,
      {
        repo: "visual/app",
        number: "7",
        author: "octo",
        draft: "false",
        category: "review",
      },
    ),
    item("sentry:1", "sentry", "error", "TypeError in board render", 25, {
      org: "visual",
      project: "web",
      level: "error",
      count: "12",
      userCount: "3",
      culprit: "board/render",
      shortId: "WEB-1",
      category: "unresolved",
    }),
    item(
      "slack:C1:1",
      "slack",
      "mention",
      "Ada in #eng: can you check the deploy",
      35,
      {
        channel: "C1",
        channelName: "eng",
        author: "Ada",
        authorId: "U1",
        ts: "1",
        conversation: "channel",
      },
    ),
  ];
  const db = new DatabaseSync(join(dir, "board.db"));
  const insertCard = db.prepare(
    "INSERT OR REPLACE INTO cards (id, data) VALUES (?, ?)",
  );
  for (const c of cards) insertCard.run(c.id, JSON.stringify(c));
  const insertItem = db.prepare(
    "INSERT OR REPLACE INTO items (id, source, state, data) VALUES (?, ?, ?, ?)",
  );
  for (const i of items)
    insertItem.run(i.id, i.source, i.state, JSON.stringify(i));
  const meta = JSON.parse(
    db.prepare("SELECT data FROM meta WHERE id = 0").get()?.data ?? "{}",
  );
  db.prepare(
    "INSERT INTO meta (id, data) VALUES (0, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data",
  ).run(JSON.stringify({ ...meta, syncedAt: iso(1), groupTicketCounter: 1 }));
  db.close();
}

await assertNoLiveService();
await assertPortFree();
const dir = join(tmpdir(), "dispatch-visual", kind);
rmSync(dir, { recursive: true, force: true });
mkdirSync(join(dir, "home"), { recursive: true });
const config =
  kind === "fresh"
    ? { port, updateCheck: false }
    : {
        port,
        workspaceRoot: join(dir, "workspaces"),
        updateCheck: false,
        onboardingDone: true,
        sources: { slack: { enabled: true, mode: "token", channels: [] } },
      };
writeFileSync(
  join(dir, "config.json"),
  JSON.stringify(config, null, 2) + "\n",
  {
    mode: 0o600,
  },
);

if (kind === "seeded") {
  const warm = boot(dir, "ignore");
  await waitReady();
  warm.kill("SIGTERM");
  await new Promise((r) => warm.once("exit", r));
  seedRows(dir);
}

const server = boot(dir, "inherit");
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => server.kill(signal));
server.once("exit", (code) => {
  rmSync(dir, { recursive: true, force: true });
  process.exit(code ?? 0);
});
