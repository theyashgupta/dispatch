import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseSeedArgs } from "./seed-args.mjs";

const STRIPPED_PREFIXES = ["DISPATCH_", "CLAUDE_", "ANTHROPIC_"];
const STRIPPED_NAMES = new Set(["TMUX", "TMUX_PANE", "NODE_ENV"]);
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
 * The parent env loses every `DISPATCH_`, `CLAUDE_` and `ANTHROPIC_` variable plus the tmux and `NODE_ENV` ones, so no key or account folder of the shell reaches the server.
 */
function boot(dir, stdio) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    const stripped =
      STRIPPED_NAMES.has(key) ||
      STRIPPED_PREFIXES.some((prefix) => key.startsWith(prefix));
    if (!stripped) env[key] = value;
  }
  return spawn(process.execPath, [ENTRY], {
    env: {
      ...env,
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

/** One ORC board card: a group with loop progress, or a local ticket. */
function orcCard(id, title, column, minutesAgo, source, extra) {
  return {
    id,
    issueId: id,
    identifier: id,
    title,
    description: null,
    priority: 0,
    column,
    updatedAt: iso(minutesAgo),
    source,
    memberIds: [],
    boardKey: "ORC",
    ...extra,
  };
}

/** One session record with the supervisor state and the meters the dashboard reads. */
function orcSession(id, minutesAgo, extra) {
  return {
    id,
    createdAt: iso(minutesAgo + 130),
    updatedAt: iso(minutesAgo),
    claudeAccountId: "default",
    stateSince: iso(minutesAgo),
    model: "opus",
    metersAt: iso(1),
    ...extra,
  };
}

/** One loop unit whose first `passed` phases hold a passing gate and whose next phase holds a failing one when `failed` is set. */
function orcUnit(
  number,
  title,
  status,
  phaseTotal,
  passed,
  minutesAgo,
  failed,
) {
  const phases = [];
  for (let n = 1; n <= passed; n++)
    phases.push({
      number: n,
      name: `Phase ${n}`,
      gate: "pass",
      attempts: 1,
      passedAt: iso(minutesAgo + (passed - n) * 12),
      retryBudget: 2,
    });
  if (failed)
    phases.push({
      number: passed + 1,
      name: `Phase ${passed + 1}`,
      gate: "fail",
      attempts: 2,
      passedAt: null,
      retryBudget: 3,
    });
  return {
    number,
    ticket: `ORC-${10 + number}`,
    title,
    status,
    statusText: status,
    branch: `feat/ORC-${10 + number}-unit-${number}`,
    commit: null,
    prdPath: null,
    phaseTotal,
    phases,
  };
}

/** The loop model of a group card in the shape the progress reader stores. */
function orcLoop(slug, units, completion, currentUnit, currentPhase, lastGate) {
  return {
    slug,
    roadmapFile: "ROADMAP.md",
    units,
    engine: null,
    completion,
    summary: {
      unitsDone: units.filter((u) => u.status === "shipped").length,
      unitsTotal: units.length,
      currentUnit,
      currentPhase,
      lastGate,
    },
    warnings: [],
    readAt: iso(1),
  };
}

/**
 * Write the second board, ORC, with a main orchestrator, running loops, session states, open decisions, events and costs.
 *
 * @remarks The group cards have no workspace path, so the loop progress reader never replaces the stored loop model.
 */
function seedOrchestrated(db) {
  const policy = {
    roadmapApproval: "ask",
    concurrencyCap: 3,
    loopModel: null,
    orchestratorModel: "opus",
    handoffPercent: 50,
    handoffHardPercent: 80,
    usageLimit: "wait",
    shipRights: "open_prs",
    budgetPerGroup: 20,
    supervisor: "off",
  };
  const orchestrators = [
    {
      id: "orch-main",
      name: "Main",
      role: "main",
      scope: { groupIds: [], ticketIds: [] },
      policyOverride: {},
      cardId: null,
      state: "stopped",
      createdAt: iso(600),
    },
  ];
  db.prepare(
    "INSERT OR REPLACE INTO boards (key, name, workspace_root, repositories, linear_team_keys, last_used_folder, policy, created_at, archived, orchestrators) VALUES ('ORC', 'Orchestrated', NULL, '[]', '[]', NULL, ?, ?, 0, ?)",
  ).run(JSON.stringify(policy), iso(600), JSON.stringify(orchestrators));

  const gate = (unit, phase, result, minutesAgo) => ({
    unit,
    phase,
    result,
    at: iso(minutesAgo),
  });
  const branch = (name, state, pr, checks) => ({
    name,
    title: name,
    body: "",
    state,
    pr,
    checks,
    identity: state === "merged" ? "passed" : null,
    admin: false,
    tip: null,
    checked: null,
  });
  const group = (id, title, column, minutesAgo, extra) =>
    orcCard(id, title, column, minutesAgo, "group", extra);
  const ticket = (id, title, column, minutesAgo, extra = {}) =>
    orcCard(id, title, column, minutesAgo, "local", extra);
  const cards = [
    group("GROUP-21", "Billing migration", "in_progress", 4, {
      loopProgress: orcLoop(
        "billing",
        [
          orcUnit(1, "Schema", "shipped", 6, 6, 200),
          orcUnit(2, "Backfill", "in progress", 9, 3, 6),
          orcUnit(3, "Cutover", "not started", 5, 0, 0),
        ],
        "running",
        2,
        { number: 4, name: "Phase 4" },
        gate(2, 3, "pass", 6),
      ),
      sessions: [
        orcSession("s21", 4, {
          state: "working",
          cost: 6.4,
          contextPercent: 42,
          usage: { fiveHourPercent: 31, sevenDayPercent: 48 },
        }),
      ],
      activeSessionId: "s21",
    }),
    group("GROUP-22", "Search indexing", "needs_input", 14, {
      statusReason: "Reindex the archive first, or ship the new analyzer?",
      loopProgress: orcLoop(
        "search",
        [
          orcUnit(1, "Analyzer", "in progress", 8, 4, 40, true),
          orcUnit(2, "Reindex", "not started", 6, 0, 0),
        ],
        "running",
        1,
        { number: 5, name: "Phase 5" },
        gate(1, 5, "fail", 20),
      ),
      sessions: [
        orcSession("s22", 14, {
          state: "needs_input",
          cost: 11.2,
          contextPercent: 66,
          usage: { fiveHourPercent: 31, sevenDayPercent: 48 },
        }),
      ],
      activeSessionId: "s22",
    }),
    group("GROUP-23", "Docs overhaul", "in_review", 90, {
      loopProgress: orcLoop(
        "docs",
        [
          orcUnit(1, "Guide", "shipped", 4, 4, 300),
          orcUnit(2, "Reference", "built, awaiting /ship", 4, 4, 150),
        ],
        "complete",
        null,
        null,
        gate(2, 4, "pass", 150),
      ),
      shipFlow: {
        state: "running",
        rights: "open_prs",
        repository: "/tmp/repo",
        repo: null,
        orchestratorId: "orch-main",
        identity: { name: "Dispatch", email: "dispatch@example.invalid" },
        branches: [
          branch("feat/ORC-11-unit-1", "merged", 41, "passed"),
          branch("feat/ORC-12-unit-2", "waiting_checks", 42, "pending"),
          branch("test/docs-specs", "queued", null, null),
        ],
        failedStep: null,
        reason: null,
        decisionId: null,
        startedAt: iso(50),
        finishedAt: null,
      },
      sessions: [orcSession("s23", 90, { cost: 3.5, contextPercent: 18 })],
      activeSessionId: "s23",
    }),
    group("GROUP-24", "Auth cleanup", "in_progress", 35, {
      loopProgress: orcLoop(
        "auth",
        [
          orcUnit(1, "Tokens", "in progress", 7, 2, 30),
          orcUnit(2, "Sessions", "not started", 5, 0, 0),
        ],
        "running",
        1,
        { number: 3, name: "Phase 3" },
        gate(1, 2, "pass", 30),
      ),
      sessions: [
        orcSession("s24", 35, {
          state: "stale",
          cost: 8.9,
          contextPercent: 38,
          usage: { fiveHourPercent: 31, sevenDayPercent: 48 },
        }),
      ],
      activeSessionId: "s24",
    }),
    group("GROUP-25", "Export service", "needs_input", 25, {
      sessions: [
        orcSession("s25", 25, {
          state: "needs_input",
          stateReason: "usage_stop",
          cost: 9.8,
          contextPercent: 51,
        }),
      ],
      activeSessionId: "s25",
    }),
    ticket("ORC-101", "Permission prompt ticket", "in_progress", 21, {
      sessions: [orcSession("s101", 21, { state: "permission_prompt" })],
      activeSessionId: "s101",
    }),
    ticket("ORC-102", "Todo by the orchestrator", "todo", 60, {
      createdByOrchestrator: "orch-main",
    }),
    ticket("ORC-103", "Plain todo ticket", "todo", 70),
    ticket("ORC-104", "Agent done ticket", "agent_done", 45, {
      createdByOrchestrator: "orch-main",
    }),
    ticket("ORC-105", "Parked ticket", "parked", 300),
    ticket("ORC-106", "Done ticket", "done", 500),
  ];
  const insertCard = db.prepare(
    "INSERT OR REPLACE INTO cards (id, data, board_key) VALUES (?, ?, 'ORC')",
  );
  for (const c of cards) insertCard.run(c.id, JSON.stringify(c));

  const decision = (id, cardId, question, minutesAgo, recommended) => ({
    id,
    boardKey: "ORC",
    cardId,
    orchestratorId: "orch-main",
    kind: "ruling",
    question,
    options: [
      { id: "a", label: "Option A" },
      { id: "b", label: "Option B" },
    ],
    recommendedOptionId: recommended,
    state: "open",
    answer: null,
    createdAt: iso(minutesAgo),
    answeredAt: null,
  });
  const decisions = [
    decision(
      "dec-orc-1",
      "GROUP-22",
      "Retry the Phase 5 gate now, or send GROUP-22 a fix instruction first?",
      12,
      "a",
    ),
    decision(
      "dec-orc-2",
      "GROUP-21",
      "Backfill in one pass, or in batches of 10 000 rows?",
      30,
      null,
    ),
  ];
  const insertDecision = db.prepare(
    "INSERT OR REPLACE INTO decision_items (id, board_key, state, data) VALUES (?, 'ORC', 'open', ?)",
  );
  for (const d of decisions) insertDecision.run(d.id, JSON.stringify(d));

  const events = [
    [
      "GROUP-23",
      "s23",
      "loop_gate",
      { unit: 2, phase: 4, result: "pass" },
      150,
    ],
    ["GROUP-21", "s21", "loop_gate", { unit: 2, phase: 3, result: "pass" }, 6],
    ["GROUP-22", "s22", "loop_gate", { unit: 1, phase: 5, result: "fail" }, 20],
    ["GROUP-21", "s21", "supervisor_action", { action: "continue" }, 52],
    ["GROUP-24", "s24", "supervisor_action", { action: "nudge" }, 33],
    ["GROUP-25", "s25", "supervisor_action", { action: "limit_wait" }, 25],
    [
      "ORC-101",
      "s101",
      "supervisor_state",
      {
        from: "working",
        to: "permission_prompt",
        evidence: "Allow WebFetch: docs.github.com?",
      },
      21,
    ],
    [
      "GROUP-22",
      null,
      "tool_call",
      {
        orchestratorId: "orch-main",
        tool: "create_decision_item",
        args: {},
        status: 201,
        result: "created",
      },
      12,
    ],
    ["GROUP-22", null, "decision_raised", { decisionId: "dec-orc-1" }, 12],
  ];
  const insertEvent = db.prepare(
    "INSERT INTO orchestration_events (board_key, card_id, session_id, kind, data, ts) VALUES ('ORC', ?, ?, ?, ?, ?)",
  );
  for (const [cardId, sessionId, kind, data, minutesAgo] of events)
    insertEvent.run(
      cardId,
      sessionId,
      kind,
      JSON.stringify(data),
      iso(minutesAgo),
    );
}

/** Merge the sync time and the given fields into the store meta row. */
function writeMeta(db, extra) {
  const meta = JSON.parse(
    db.prepare("SELECT data FROM meta WHERE id = 0").get()?.data ?? "{}",
  );
  db.prepare(
    "INSERT INTO meta (id, data) VALUES (0, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data",
  ).run(JSON.stringify({ ...meta, syncedAt: iso(1), ...extra }));
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
  writeMeta(db, { groupTicketCounter: 1 });
  db.close();
}

/** Write the ORC board rows into the schema the warm boot created. */
function seedOrchestratedRows(dir) {
  const db = new DatabaseSync(join(dir, "board.db"));
  seedOrchestrated(db);
  writeMeta(db, {});
  db.close();
}

await assertNoLiveService();
await assertPortFree();
const dir = mkdtempSync(join(tmpdir(), `dispatch-visual-${kind}-`));
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

if (kind !== "fresh") {
  const warm = boot(dir, "ignore");
  await waitReady();
  warm.kill("SIGTERM");
  await new Promise((r) => warm.once("exit", r));
  if (kind === "seeded") seedRows(dir);
  else seedOrchestratedRows(dir);
}

const server = boot(dir, "inherit");
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => server.kill(signal));
server.once("exit", (code) => {
  rmSync(dir, { recursive: true, force: true });
  process.exit(code ?? 0);
});
