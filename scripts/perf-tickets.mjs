/**
 * Measures the Tickets page at 250 Linear tickets: the longest main-thread task while `#/tickets`
 * loads, and the longest task while the Group by select switches through every dimension, as the
 * median of three rounds so one burst of CPU contention on a shared machine cannot decide the result.
 *
 * @remarks The script seeds its own sandbox HOME under `os.tmpdir()` with a `dispatch-perf-tickets-`
 * basename, writes cards straight into that sandbox board.db through node:sqlite, and gives the
 * sandbox config only an obviously fake Linear key, so it never reads the real `~/.dispatch` and never
 * calls Linear with a real key. It boots only the production build (no dev mode, whose proxy targets
 * the live port) on a free port that is never 4700 or 4710, and it removes the sandbox, the server and
 * Chrome on a normal exit or an error. Usage: `node scripts/perf-tickets.mjs` after `npm run build`; it prints one
 * `PERF-TICKETS rows=<n> loadLongestTaskMs=<n> switchLongestTaskMs=<n>` line and exits 1 on a missed
 * budget (rows not 250, load over 200 ms, switch over 100 ms).
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST_ENTRY = join(REPO_ROOT, "dist", "server", "bootstrap", "index.js");
const SANDBOX_PREFIX = "dispatch-perf-tickets-";
const FORBIDDEN_PORTS = new Set([4700, 4710]);
const CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];
const FAKE_LINEAR_API_KEY = "perf-tickets-harness-fake-key-never-real";

const TICKET_COUNT = 250;
const ROUNDS = 3;
const LOAD_BUDGET_MS = 200;
const SWITCH_BUDGET_MS = 100;
const POLL_INTERVAL_MS = 100;
const READY_TIMEOUT_MS = 30_000;
const RENDER_TIMEOUT_MS = 30_000;
const KILL_TIMEOUT_MS = 5_000;
const LOAD_QUIET_MS = 1_000;
const SWITCH_QUIET_MS = 500;

const STATES = [
  { name: "Triage", type: "triage", color: "#fc7840" },
  { name: "Backlog", type: "backlog", color: "#bec2c8" },
  { name: "Todo", type: "unstarted", color: "#e2e2e2" },
  { name: "In Progress", type: "started", color: "#f2c94c" },
  { name: "Done", type: "completed", color: "#5e6ad2" },
  { name: "Canceled", type: "canceled", color: "#95a2b3" },
];
const PROJECTS = [
  { id: "perf-project-core", name: "Core" },
  { id: "perf-project-web", name: "Web" },
  { id: "perf-project-ops", name: "Ops" },
  null,
];
const CYCLES = [14, 15, 16, 17];
const TEAMS = [
  { id: "perf-team-eng", key: "ENG", name: "Engineering" },
  { id: "perf-team-ops", key: "OPS", name: "Operations" },
];
const OPEN_COLUMNS = ["inbox", "todo", "in_review", "parked"];

/**
 * Group count each dimension must render once the switch lands.
 *
 * @remarks Derived from the seed spread: 6 states, 4 priorities, 3 projects plus "No project", 4
 * cycles, 2 teams; "none" renders no group wrapper at all.
 */
const EXPECTED_GROUPS = {
  priority: 4,
  project: 4,
  cycle: 4,
  team: 2,
  none: 0,
  status: 6,
};

const OBSERVER_SOURCE = `
window.__perfTickets = { max: 0, lastEnd: 0, mark: 0 };
new PerformanceObserver((list) => {
  for (const e of list.getEntries()) {
    const p = window.__perfTickets;
    if (e.duration > p.max) p.max = e.duration;
    if (e.startTime + e.duration > p.lastEnd) p.lastEnd = e.startTime + e.duration;
  }
}).observe({ type: "longtask", buffered: true });
`;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Throw unless `home` and `port` are safe to use for a throwaway server.
 *
 * @remarks Called before any write or spawn that touches `home`, so a bad path or the live port
 * stops the run instead of touching real data.
 */
function assertSandboxSafe(home, port) {
  if (FORBIDDEN_PORTS.has(port)) {
    throw new Error(`port ${port} belongs to a live dispatch instance.`);
  }
  if (home === homedir()) {
    throw new Error("sandbox home must never equal the real $HOME.");
  }
  if (!home.startsWith(tmpdir())) {
    throw new Error(`sandbox home ${home} must live under ${tmpdir()}.`);
  }
  if (!basename(home).startsWith(SANDBOX_PREFIX)) {
    throw new Error(
      `sandbox home ${home} must have a basename starting with "${SANDBOX_PREFIX}".`,
    );
  }
}

/** Ask the OS for a free TCP port, retrying past the ports a live instance owns. */
async function freePort() {
  for (;;) {
    const port = await new Promise((resolve, reject) => {
      const srv = createServer();
      srv.once("error", reject);
      srv.listen(0, "127.0.0.1", () => {
        const { port: p } = srv.address();
        srv.close(() => resolve(p));
      });
    });
    if (!FORBIDDEN_PORTS.has(port)) return port;
  }
}

/** Create the sandbox HOME with a config that carries only the fake Linear key. */
function makeSandboxHome(port) {
  const home = join(tmpdir(), `${SANDBOX_PREFIX}${process.pid}`);
  assertSandboxSafe(home, port);
  const dispatchDir = join(home, ".dispatch");
  mkdirSync(dispatchDir, { recursive: true });
  writeFileSync(
    join(dispatchDir, "config.json"),
    JSON.stringify(
      {
        port,
        workspaceRoot: join(home, "workspaces"),
        statusChannel: "auto",
        updateCheck: false,
        sources: { linear: { apiKey: FAKE_LINEAR_API_KEY } },
      },
      null,
      2,
    ) + "\n",
    { mode: 0o600 },
  );
  return home;
}

/** Poll `GET /api/board` until the server answers 200. */
async function waitForReady(port) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/board`);
      await res.body?.cancel();
      if (res.status === 200) return;
    } catch {}
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(
    `server on :${port} did not answer within ${READY_TIMEOUT_MS}ms`,
  );
}

/** Send SIGTERM, escalate to SIGKILL after a grace period, and resolve once the child exits. */
function killAndWait(child) {
  if (child == null) return Promise.resolve();
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    const escalate = setTimeout(() => child.kill("SIGKILL"), KILL_TIMEOUT_MS);
    child.once("exit", () => {
      clearTimeout(escalate);
      resolve();
    });
    child.kill("SIGTERM");
  });
}

function findChrome() {
  return CHROME_CANDIDATES.find((p) => existsSync(p));
}

/** Spawn the production server against the sandbox HOME. */
function bootServer(home) {
  return spawn("node", [DIST_ENTRY], {
    env: {
      ...process.env,
      HOME: home,
      DISPATCH_DIR: join(home, ".dispatch"),
      NODE_ENV: "production",
    },
    stdio: ["ignore", "ignore", "ignore"],
  });
}

/** Build the seeded Linear card `i`, spreading every grouping dimension across the set. */
function seedCard(i) {
  const id = `perf-ticket-${i}`;
  return {
    id,
    issueId: `perf-issue-${i}`,
    identifier: `${TEAMS[i % 2].key}-${1000 + i}`,
    title: `Seeded ticket ${i} for the Tickets page perf harness`,
    description: null,
    source: "linear",
    priority: 1 + (i % 4),
    column: i % 25 === 4 ? "done" : OPEN_COLUMNS[i % 4],
    updatedAt: new Date(Date.now() - i * 60_000).toISOString(),
    linearState: STATES[i % 6],
    project: PROJECTS[(i >> 1) % 4],
    cycle: CYCLES[(i >> 2) % 4],
    team: TEAMS[i % 2],
    url: `https://linear.app/perf/issue/${id}`,
  };
}

/**
 * Boot once so the store creates the real schema, then insert every seeded card through node:sqlite.
 *
 * @remarks Only 10 cards land in Done so the wire's default Done window (50) keeps all 250 on the page.
 */
async function seedTickets(home, port) {
  const warmup = bootServer(home);
  try {
    await waitForReady(port);
  } finally {
    await killAndWait(warmup);
  }
  const db = new DatabaseSync(join(home, ".dispatch", "board.db"));
  try {
    const insert = db.prepare(
      `INSERT INTO cards (id, data) VALUES (?, ?)
       ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
    );
    db.exec("BEGIN");
    try {
      for (let i = 0; i < TICKET_COUNT; i++) {
        const card = seedCard(i);
        insert.run(card.id, JSON.stringify(card));
      }
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  } finally {
    db.close();
  }
}

/** Open a raw CDP connection over the Node global WebSocket, with a promise per command id. */
async function connectCDP(cdpPort) {
  const res = await fetch(`http://127.0.0.1:${cdpPort}/json/version`);
  const { webSocketDebuggerUrl } = await res.json();
  const ws = new WebSocket(webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  let nextId = 1;
  const pending = new Map();
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    const waiter = pending.get(msg.id);
    if (!waiter) return;
    pending.delete(msg.id);
    if (msg.error) waiter.reject(new Error(msg.error.message));
    else waiter.resolve(msg.result);
  });
  return {
    send(method, params = {}, sessionId) {
      return new Promise((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params, sessionId }));
      });
    },
    close: () => ws.close(),
  };
}

/** Evaluate `expression` in the page and return its value, throwing on a page exception. */
async function evalValue(cdp, sessionId, expression) {
  const { result, exceptionDetails } = await cdp.send(
    "Runtime.evaluate",
    { expression, returnByValue: true },
    sessionId,
  );
  if (exceptionDetails) {
    throw new Error(`Runtime.evaluate failed: ${exceptionDetails.text}`);
  }
  return result.value;
}

/** Poll `expression` until it is truthy or the render timeout passes. */
async function waitFor(cdp, sessionId, expression, what) {
  const deadline = Date.now() + RENDER_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await evalValue(cdp, sessionId, expression)) return;
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** Wait until no long task has ended for `quietMs` after the last mark, then return the max seen. */
async function settleAndReadMax(cdp, sessionId, quietMs) {
  await waitFor(
    cdp,
    sessionId,
    `(() => { const p = window.__perfTickets;
      return performance.now() - Math.max(p.lastEnd, p.mark) >= ${quietMs}; })()`,
    "a quiet main thread",
  );
  return evalValue(cdp, sessionId, "window.__perfTickets.max");
}

const ROWS_EXPR = `document.querySelectorAll('[id^="ticket-row-"]').length`;
const GROUPS_EXPR = `document.querySelectorAll('[data-testid="tickets-group"]').length`;

/** Launch headless Chrome on `cdpPort` with a throwaway profile and wait for its debugger. */
async function launchChrome(chromePath, cdpPort, profileDir) {
  const child = spawn(
    chromePath,
    [
      "-headless=new",
      `-remote-debugging-port=${cdpPort}`,
      `-user-data-dir=${profileDir}`,
      "-no-first-run",
      "-window-size=1280,900",
    ],
    { stdio: ["ignore", "ignore", "ignore"] },
  );
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${cdpPort}/json/version`);
      await res.body?.cancel();
      if (res.status === 200) return child;
    } catch {}
    await sleep(POLL_INTERVAL_MS);
  }
  await killAndWait(child);
  throw new Error(`Chrome debugging port :${cdpPort} did not come up`);
}

/**
 * Load `#/tickets`, then switch the group through every dimension, returning the three numbers.
 *
 * @remarks The page opens on its default "status" grouping, so the switch order ends on status to
 * make each of the six switches a real regroup.
 */
async function measure(cdp, sessionId, port) {
  await cdp.send(
    "Page.navigate",
    { url: `http://127.0.0.1:${port}/#/tickets` },
    sessionId,
  );
  await waitFor(cdp, sessionId, `${ROWS_EXPR} >= ${TICKET_COUNT}`, "rows");
  await evalValue(
    cdp,
    sessionId,
    "window.__perfTickets.mark = performance.now()",
  );
  const loadMax = await settleAndReadMax(cdp, sessionId, LOAD_QUIET_MS);
  const rows = await evalValue(cdp, sessionId, ROWS_EXPR);

  let switchMax = 0;
  for (const [by, groups] of Object.entries(EXPECTED_GROUPS)) {
    await evalValue(
      cdp,
      sessionId,
      `(() => {
        const p = window.__perfTickets;
        p.max = 0;
        p.mark = performance.now();
        const select = document.querySelector('select[aria-label="Group by"]');
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(select, ${JSON.stringify(by)});
        select.dispatchEvent(new Event("change", { bubbles: true }));
      })()`,
    );
    await waitFor(
      cdp,
      sessionId,
      `${GROUPS_EXPR} === ${groups} && ${ROWS_EXPR} === ${TICKET_COUNT}`,
      `the ${by} grouping`,
    );
    switchMax = Math.max(
      switchMax,
      await settleAndReadMax(cdp, sessionId, SWITCH_QUIET_MS),
    );
  }
  return {
    rows,
    loadLongestTaskMs: Math.round(loadMax),
    switchLongestTaskMs: Math.round(switchMax),
  };
}

/** The middle value of an odd-length list of numbers. */
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

async function main() {
  if (!existsSync(DIST_ENTRY)) {
    console.error(
      `Missing ${DIST_ENTRY}. Run the production build (npm run build) first.`,
    );
    process.exit(1);
  }
  const chromePath = findChrome();
  if (!chromePath) {
    console.error(`No Chrome found at: ${CHROME_CANDIDATES.join(", ")}`);
    process.exit(1);
  }

  const port = await freePort();
  let cdpPort = await freePort();
  while (cdpPort === port) cdpPort = await freePort();
  const home = makeSandboxHome(port);
  const profileDir = join(home, "chrome-profile");
  let server = null;
  let chrome = null;
  let cdp = null;
  try {
    await seedTickets(home, port);
    server = bootServer(home);
    await waitForReady(port);
    chrome = await launchChrome(chromePath, cdpPort, profileDir);
    cdp = await connectCDP(cdpPort);
    const { targetId } = await cdp.send("Target.createTarget", {
      url: "about:blank",
    });
    const { sessionId } = await cdp.send("Target.attachToTarget", {
      targetId,
      flatten: true,
    });
    await cdp.send("Page.enable", {}, sessionId);
    await cdp.send("Runtime.enable", {}, sessionId);
    await cdp.send(
      "Page.addScriptToEvaluateOnNewDocument",
      { source: OBSERVER_SOURCE },
      sessionId,
    );
    const rounds = [];
    for (let i = 0; i < ROUNDS; i += 1) {
      rounds.push(await measure(cdp, sessionId, port));
    }
    const r = {
      rows: Math.min(...rounds.map((x) => x.rows)),
      loadLongestTaskMs: median(rounds.map((x) => x.loadLongestTaskMs)),
      switchLongestTaskMs: median(rounds.map((x) => x.switchLongestTaskMs)),
    };
    console.log(
      `PERF-TICKETS-ROUNDS ${rounds.map((x) => `load=${x.loadLongestTaskMs}/switch=${x.switchLongestTaskMs}`).join(" ")}`,
    );
    console.log(
      `PERF-TICKETS rows=${r.rows} loadLongestTaskMs=${r.loadLongestTaskMs} switchLongestTaskMs=${r.switchLongestTaskMs}`,
    );
    if (
      r.rows !== TICKET_COUNT ||
      r.loadLongestTaskMs > LOAD_BUDGET_MS ||
      r.switchLongestTaskMs > SWITCH_BUDGET_MS
    ) {
      process.exitCode = 1;
    }
  } finally {
    cdp?.close();
    await killAndWait(chrome);
    await killAndWait(server);
    rmSync(home, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(`perf-tickets failed: ${err.stack ?? err.message}`);
  process.exit(1);
});
