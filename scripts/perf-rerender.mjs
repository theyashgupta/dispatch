/**
 * Board re-render measurement harness (PERF-01d, dev/ops tooling, NOT test code): imports no test
 * framework, asserts nothing about app runtime behavior, and lives outside src/ — the same category
 * as check-invariants.mjs, perf-boot.mjs, perf-subproc.mjs, and perf-sse.mjs.
 *
 * It answers a question none of the exec-chokepoint/HTTP harnesses can: how many React commits does
 * a fixed board interaction script cause? It drives headless Chrome via raw CDP over Node's built-in
 * global WebSocket/fetch (zero new npm dependency, the same technique proven in this repo's own
 * history — 55-02-SUMMARY.md, 57-04-SUMMARY.md), injecting a `window.__REACT_DEVTOOLS_GLOBAL_HOOK__`
 * shim via `Page.addScriptToEvaluateOnNewDocument` BEFORE the page (and therefore react-dom) loads,
 * so every commit anywhere in the tree increments a page-global counter via `onCommitFiberRoot`.
 *
 * Serve mode is a DELIBERATE, recorded choice, never a silent auto-switch (58-RESEARCH.md Open Q2):
 * the default tries the PRODUCTION build first (`NODE_ENV=production node dist/server/bootstrap/
 * index.js`, matching how boot/subprocess/SSE are measured); if react-dom's production build never
 * calls the shim (raw counter stays 0 after the first interaction), the harness prints a loud
 * diagnostic and exits 2 rather than silently falling back — a human (or a scripted re-run) must
 * explicitly pass `--dev` to use the `tsx watch` backend + `vite` dev-server fallback instead, so the
 * PERF-04 Compiler spike's before/after comparison always cites the SAME mode.
 *
 * Interactions are driven via a real DOM `.click()` (not synthesized pointer/mouse CDP events): React
 * attaches one delegated listener at the root and treats a native `click` Event identically regardless
 * of how it was dispatched, so this is behaviorally equivalent to a real pointer click for state/commit
 * purposes while keeping the harness simpler than a full Input.dispatchMouseEvent coordinate-targeting
 * dance (unlike 57-04's a11y proof, which specifically needed real keyboard events to prove focus/ARIA
 * wiring — this harness only needs to trigger the same state transitions, not prove input fidelity).
 *
 * Card seeding follows 58-01/perf-sse.mjs's precedent: a fresh sandbox board starts empty, so a real
 * (read-only) Linear sync populates one card — only `apiKey`/`filters` are lifted from the real
 * `~/.dispatch/config.json`; `board.db` is NEVER copied. The seeded card is promoted todo->done->todo
 * for the SSE-mutation step, then demoted back to inbox at teardown.
 *
 * Usage:
 *   node scripts/perf-rerender.mjs            try production dist/ build (default)
 *   node scripts/perf-rerender.mjs --dev       use tsx watch + vite dev-server fallback directly
 *
 * Prints per-interaction deltas, then a machine-parsable summary:
 *   PERF-RERENDER mode=<prod|dev> total=<n> toggle=<n> inbox=<n> select=<n> sse=<n>
 *
 * Exit codes: 0 success. 1 setup/teardown error. 2 production hook never fired — rerun with --dev.
 */
import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir, homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const execFileP = promisify(execFile);

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST_ENTRY = join(REPO_ROOT, "dist", "server", "bootstrap", "index.js");
const BACKEND_ENTRY = join(REPO_ROOT, "src", "server", "bootstrap", "index.ts");
const VITE_BIN = join(REPO_ROOT, "node_modules", ".bin", "vite");
const TSX_BIN = join(REPO_ROOT, "node_modules", ".bin", "tsx");

const PROD_PORT = 4858;
const DEV_BACKEND_PORT = 4700; // vite.config.ts hardcodes its /api/ proxy target to this port
const DEV_FRONTEND_PORT = 5199;
const CDP_PORT = 9358;

const POLL_INTERVAL_MS = 100;
const READY_TIMEOUT_MS = 30_000;
const SYNC_TIMEOUT_MS = 30_000;
const APP_TIMEOUT_MS = 20_000;
const KILL_TIMEOUT_MS = 5_000;
const SETTLE_MS = 350;
const SSE_SETTLE_MS = 500;

const CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

/** True when `--dev` is present on argv (deliberate, recorded serve-mode choice — never auto-switched). */
function readDevFlag(argv) {
  return argv.includes("--dev");
}

/** Locate a local Chrome binary, or throw with a clear message if none of the known paths exist. */
function findChrome() {
  const found = CHROME_CANDIDATES.find((p) => existsSync(p));
  if (!found) {
    throw new Error(
      `No Chrome binary found at any known path: ${CHROME_CANDIDATES.join(", ")}`,
    );
  }
  return found;
}

/** Read only `sources.linear.apiKey`/`filters` from the real config — never `board.db`. */
function readRealLinearSource() {
  const realConfigPath = join(homedir(), ".dispatch", "config.json");
  if (!existsSync(realConfigPath)) {
    throw new Error(
      `${realConfigPath} not found — perf-rerender.mjs needs a real Linear apiKey to seed one card ` +
        "(only apiKey/filters are read, board.db is never touched).",
    );
  }
  const parsed = JSON.parse(readFileSync(realConfigPath, "utf8"));
  const linear = parsed?.sources?.linear;
  const apiKey = typeof linear?.apiKey === "string" ? linear.apiKey.trim() : "";
  if (!apiKey) {
    throw new Error(
      `${realConfigPath} has no sources.linear.apiKey — perf-rerender.mjs needs one to seed a card.`,
    );
  }
  return { apiKey, filters: linear.filters };
}

/** Sandbox HOME with a fresh board.db and the real (read-only) Linear apiKey/filters lifted in. */
function makeSandboxHome(label, port) {
  const home = join(tmpdir(), `dispatch-perf-rerender-${label}-${process.pid}`);
  const dispatchDir = join(home, ".dispatch");
  mkdirSync(dispatchDir, { recursive: true });
  const { apiKey, filters } = readRealLinearSource();
  writeFileSync(
    join(dispatchDir, "config.json"),
    JSON.stringify(
      {
        port,
        workspaceRoot: join(home, "workspaces"),
        statusChannel: "auto",
        updateCheck: false,
        sources: { linear: { apiKey, filters } },
      },
      null,
      2,
    ) + "\n",
    { mode: 0o600 },
  );
  return home;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Poll `GET /api/board` on `port` until it returns 200. */
async function waitForReady(port) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/board`);
      await res.body?.cancel();
      if (res.status === 200) return;
    } catch {
      // server not listening yet — keep polling
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(
    `server on :${port} did not answer 200 on /api/board within ${READY_TIMEOUT_MS}ms`,
  );
}

/** Poll `/api/board` on `port` until the real Linear sync has populated at least one card. */
async function waitForSeededCard(port) {
  const deadline = Date.now() + SYNC_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const res = await fetch(`http://127.0.0.1:${port}/api/board`);
    const snapshot = await res.json();
    if (Array.isArray(snapshot.cards) && snapshot.cards.length > 0) {
      return snapshot.cards[0];
    }
    await sleep(200);
  }
  throw new Error(
    `no card appeared on the sandbox board within ${SYNC_TIMEOUT_MS}ms — Linear sync did not populate`,
  );
}

async function moveCard(port, id, column) {
  const res = await fetch(`http://127.0.0.1:${port}/api/cards/${id}/move`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ column }),
  });
  if (res.status !== 200) {
    const body = await res.text();
    throw new Error(`move ${id} -> ${column} failed (${res.status}): ${body}`);
  }
  await res.json();
}

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

/** Minimal raw-CDP-over-WebSocket client (Node global WebSocket/fetch, zero new npm dependency). */
class CDP {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id != null && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    });
  }

  send(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const payload = { id, method, params };
      if (sessionId) payload.sessionId = sessionId;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(payload));
    });
  }

  close() {
    this.ws.close();
  }
}

async function connectCDP() {
  const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
  const info = await res.json();
  const ws = new WebSocket(info.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  return new CDP(ws);
}

/** The DevTools-global-hook shim: every commit anywhere in the tree increments `commits`. */
const HOOK_SHIM_SOURCE = `
window.__DSP_RENDER_COUNTS__ = { commits: 0 };
window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
  supportsFiber: true,
  renderers: new Map(),
  inject(renderer) {
    this.renderers.set(this.renderers.size + 1, renderer);
    return this.renderers.size;
  },
  onCommitFiberRoot() { window.__DSP_RENDER_COUNTS__.commits++; },
  onCommitFiberUnmount() {},
  onPostCommitFiberRoot() {},
  checkDCE() {},
  sub() { return function unsubscribe() {}; },
  on() {},
  off() {},
  emit() {},
};
`;

async function evalValue(cdp, sessionId, expression) {
  const { result, exceptionDetails } = await cdp.send(
    "Runtime.evaluate",
    { expression, returnByValue: true, awaitPromise: false },
    sessionId,
  );
  if (exceptionDetails) {
    throw new Error(
      `Runtime.evaluate failed: ${exceptionDetails.text} — ${expression}`,
    );
  }
  return result.value;
}

function getCommits(cdp, sessionId) {
  return evalValue(cdp, sessionId, "window.__DSP_RENDER_COUNTS__.commits");
}

async function clickSelector(cdp, sessionId, selector) {
  const ok = await evalValue(
    cdp,
    sessionId,
    `(function(){var el=document.querySelector(${JSON.stringify(selector)});if(!el)return false;el.click();return true;})()`,
  );
  if (!ok) throw new Error(`clickSelector: not found ${selector}`);
}

async function clickOrcaRow(cdp, sessionId, identifier) {
  const ok = await evalValue(
    cdp,
    sessionId,
    `(function(){
      var rows = document.querySelectorAll('nav[aria-label="Tickets"] [role="button"]');
      for (var i = 0; i < rows.length; i++) {
        if (rows[i].textContent.indexOf(${JSON.stringify(identifier)}) !== -1) {
          rows[i].click();
          return true;
        }
      }
      return false;
    })()`,
  );
  if (!ok) throw new Error(`clickOrcaRow: not found ${identifier}`);
}

async function waitForSelector(cdp, sessionId, selector, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const present = await evalValue(
      cdp,
      sessionId,
      `document.querySelector(${JSON.stringify(selector)}) != null`,
    );
    if (present) return;
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`timed out waiting for selector ${selector}`);
}

function fmt(n) {
  return String(n);
}

async function main() {
  const dev = readDevFlag(process.argv.slice(2));
  const mode = dev ? "dev" : "prod";

  if (!dev && !existsSync(DIST_ENTRY)) {
    console.error(`Missing ${DIST_ENTRY} — run \`npm run build\` first.`);
    process.exit(1);
  }

  const appPort = dev ? DEV_FRONTEND_PORT : PROD_PORT;
  const backendPort = dev ? DEV_BACKEND_PORT : PROD_PORT;
  const home = makeSandboxHome(mode, backendPort);
  const scratchDir = join(
    tmpdir(),
    `dispatch-perf-rerender-chrome-${process.pid}`,
  );
  mkdirSync(scratchDir, { recursive: true });

  let backendChild = null;
  let frontendChild = null;
  let chromeChild = null;
  let cdp = null;

  try {
    backendChild = dev
      ? spawn(TSX_BIN, [BACKEND_ENTRY], {
          env: { ...process.env, HOME: home },
          stdio: ["ignore", "ignore", "ignore"],
        })
      : spawn("node", [DIST_ENTRY], {
          env: { ...process.env, NODE_ENV: "production", HOME: home },
          stdio: ["ignore", "ignore", "ignore"],
        });
    await waitForReady(backendPort);

    if (dev) {
      frontendChild = spawn(
        VITE_BIN,
        ["--port", String(DEV_FRONTEND_PORT), "--strictPort"],
        { cwd: REPO_ROOT, stdio: ["ignore", "ignore", "ignore"] },
      );
      const deadline = Date.now() + READY_TIMEOUT_MS;
      let frontendUp = false;
      while (Date.now() < deadline) {
        try {
          const res = await fetch(`http://127.0.0.1:${DEV_FRONTEND_PORT}/`);
          await res.body?.cancel();
          if (res.status === 200) {
            frontendUp = true;
            break;
          }
        } catch {
          // vite not listening yet
        }
        await sleep(POLL_INTERVAL_MS);
      }
      if (!frontendUp) {
        throw new Error(
          `vite dev server on :${DEV_FRONTEND_PORT} did not come up within ${READY_TIMEOUT_MS}ms`,
        );
      }
    }

    const card = await waitForSeededCard(backendPort);
    console.log(
      `seeded card ${card.identifier} (${card.id}), column=${card.column}`,
    );

    chromeChild = spawn(
      findChrome(),
      [
        "--headless=new",
        `--remote-debugging-port=${CDP_PORT}`,
        `--user-data-dir=${scratchDir}`,
        "--no-first-run",
      ],
      { stdio: ["ignore", "ignore", "ignore"] },
    );

    // give Chrome a moment to open its debugging port
    {
      const deadline = Date.now() + READY_TIMEOUT_MS;
      let up = false;
      while (Date.now() < deadline) {
        try {
          const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
          await res.body?.cancel();
          if (res.status === 200) {
            up = true;
            break;
          }
        } catch {
          // not up yet
        }
        await sleep(POLL_INTERVAL_MS);
      }
      if (!up)
        throw new Error(`Chrome debugging port :${CDP_PORT} did not come up`);
    }

    cdp = await connectCDP();
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
      { source: HOOK_SHIM_SOURCE },
      sessionId,
    );
    await cdp.send(
      "Page.navigate",
      { url: `http://127.0.0.1:${appPort}/` },
      sessionId,
    );

    await waitForSelector(
      cdp,
      sessionId,
      '[aria-label="Board view"]',
      APP_TIMEOUT_MS,
    );
    await sleep(SETTLE_MS);

    // --- toggle: Board -> Orca -> Board ---
    const beforeToggle = await getCommits(cdp, sessionId);
    await clickSelector(cdp, sessionId, '[aria-label="Orca view"]');
    await sleep(SETTLE_MS);

    const afterFirstClick = await getCommits(cdp, sessionId);
    if (afterFirstClick === 0) {
      console.error(
        `PERF-RERENDER diagnostic: mode=${mode} commits stayed 0 after the first interaction — ` +
          (dev
            ? "the dev-serve fallback's react-dom build never registered with the DevTools hook shim; investigate the shim wiring."
            : "production react-dom did not register with the DevTools hook shim. Rerun with `node scripts/perf-rerender.mjs --dev`."),
      );
      process.exit(2);
    }

    await clickSelector(cdp, sessionId, '[aria-label="Board view"]');
    await sleep(SETTLE_MS);
    const afterToggle = await getCommits(cdp, sessionId);
    const toggle = afterToggle - beforeToggle;

    // --- inbox open/close ---
    const beforeInbox = await getCommits(cdp, sessionId);
    await clickSelector(cdp, sessionId, "#inbox-toggle");
    await sleep(SETTLE_MS);
    await clickSelector(cdp, sessionId, "#inbox-toggle");
    await sleep(SETTLE_MS);
    const afterInbox = await getCommits(cdp, sessionId);
    const inbox = afterInbox - beforeInbox;

    // --- card select + re-select in Orca (docked) mode ---
    await clickSelector(cdp, sessionId, '[aria-label="Orca view"]');
    await sleep(SETTLE_MS);
    const beforeSelect = await getCommits(cdp, sessionId);
    await clickOrcaRow(cdp, sessionId, card.identifier);
    await sleep(SETTLE_MS);
    await clickOrcaRow(cdp, sessionId, card.identifier);
    await sleep(SETTLE_MS);
    const afterSelect = await getCommits(cdp, sessionId);
    const select = afterSelect - beforeSelect;
    await clickSelector(cdp, sessionId, '[aria-label="Board view"]');
    await sleep(SETTLE_MS);

    // --- one SSE-driven board mutation (move + restore), idle on the board ---
    await moveCard(backendPort, card.id, "todo");
    await sleep(SSE_SETTLE_MS);
    const beforeSse = await getCommits(cdp, sessionId);
    await moveCard(backendPort, card.id, "done");
    await sleep(SSE_SETTLE_MS);
    await moveCard(backendPort, card.id, "todo");
    await sleep(SSE_SETTLE_MS);
    const afterSse = await getCommits(cdp, sessionId);
    const sse = afterSse - beforeSse;
    await moveCard(backendPort, card.id, "inbox");

    const total = toggle + inbox + select + sse;
    console.log(
      `  toggle=${fmt(toggle)} inbox=${fmt(inbox)} select=${fmt(select)} sse=${fmt(sse)}`,
    );
    console.log(
      `PERF-RERENDER mode=${mode} total=${fmt(total)} toggle=${fmt(toggle)} inbox=${fmt(inbox)} select=${fmt(select)} sse=${fmt(sse)}`,
    );
  } finally {
    if (cdp) cdp.close();
    await killAndWait(chromeChild);
    await killAndWait(frontendChild);
    await killAndWait(backendChild);
    rmSync(home, { recursive: true, force: true });
    rmSync(scratchDir, { recursive: true, force: true });

    try {
      const ports = dev
        ? [
            String(DEV_BACKEND_PORT),
            String(DEV_FRONTEND_PORT),
            String(CDP_PORT),
          ]
        : [String(PROD_PORT), String(CDP_PORT)];
      const args = ports.flatMap((p) => ["-i", `:${p}`]);
      const { stdout } = await execFileP("lsof", args).catch((err) => ({
        stdout: err.stdout ?? "",
      }));
      if (stdout.trim() !== "") {
        console.error(`WARNING: ports still held after teardown:\n${stdout}`);
      }
    } catch {
      // lsof not available or no matches — nothing to report
    }
  }
}

main().catch((err) => {
  console.error(`perf-rerender failed: ${err.stack ?? err.message}`);
  process.exit(1);
});
