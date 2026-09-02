/**
 * Phase 92 plan 07 mount-identity instrument (PROXY-01/UI-03, dev/ops tooling, NOT test code): no
 * test framework, no assertion library, lives outside src/ — the same category as panel-92.mjs,
 * density-91.mjs, session-liveness-v3.mjs. It re-proves `PANEL-03` (docs/ARCHITECTURE.md, "Panel
 * Iframe Identity") under the session-keyed terminal: opening/closing the panel, fullscreen,
 * resize, and the board/Orca view switch must never remount the terminal iframe — and CARD switch
 * while the panel stays open (the case `PANEL-03`'s own text was written to protect) must not
 * either. A SESSION switch legitimately re-points `src` on the SAME iframe element, which is the
 * corrected 92-CONTEXT.md decision this instrument exists to measure, not assume.
 *
 * SAFETY — copied verbatim from panel-92.mjs / session-liveness-v3.mjs's own headers, load-bearing
 * here too. Booting ANY dispatch server sweeps `ttyd` processes MACHINE-WIDE via `adoptAndSweep`,
 * fingerprinted by argv shape, never by tmux session name or by which board.db spawned it.
 * `assertNoLiveService()` is a FAIL-CLOSED preflight: it throws (never warns) if anything answers
 * on :4700, before this script boots any server or spawns any real tmux/ttyd. Unlike panel-92.mjs,
 * this instrument DOES spawn real tmux (a trivial `sleep`-loop shell, never `claude`) and real ttyd
 * — the terminal iframe only mounts when `card.ttydPort` is set and only connects when a
 * real ttyd answers, so an inert fixture (panel-92.mjs's own approach) cannot exercise this file's
 * actual claim.
 *
 * THE MOUNT SIGNAL — re-derived against the Phase 72 reverse proxy, not copied from Phase 55.
 * Phase 55's original `PANEL-03` proof read the BROWSER's own client port to ttyd, true only when
 * the browser connected DIRECTLY to ttyd (`92-RESEARCH.md` `## 7`). Today the socket to ttyd is
 * held by the DISPATCH SERVER process (`net.connect` inside `upgradeForward`), so reusing that
 * recipe unmodified would read a CONSTANT (the server's own pid) and pass regardless of behaviour —
 * `92-RESEARCH.md` `## 3`/Pitfall 3's exact dead-instrument hazard. Two signals are measured on
 * every step, reported SEPARATELY so a disagreement between them is visible rather than averaged
 * away:
 *   1. AN IFRAME EXPANDO (the sharper signal, and the primary one this file gates on): an inert
 *      property set on the `<iframe>` DOM node itself through CDP before the interaction script.
 *      React remounting the element destroys the property; a `src` change on the SAME element
 *      preserves it. Not subject to the two-hop subtlety at all.
 *   2. THE DISPATCH-SIDE LOCAL EPHEMERAL PORT of the upstream (dispatch->ttyd) connection, read via
 *      `lsof -nP -iTCP:<ttydPort> -sTCP:ESTABLISHED -Fpn` scoped to the sandbox server's own pid,
 *      parsing the LOCAL half of the `local->remote` NAME column (the repo's own
 *      `countEstablishedToPort` idiom, `session-liveness-v3.mjs`). A fresh `net.connect` on any
 *      reconnect — remount OR a legitimate `src` re-point — mints a NEW local port; the pid does
 *      not. `--dead-signal-demo` substitutes the (constant) server pid for this value, on purpose,
 *      to demonstrate why the naive substitution is dead (Task 2).
 *
 * SIX INTERACTION-SCRIPT STEPS, five forbidden (no expando change, no local-port drift) and one
 * legitimate (expando must survive, local port is EXPECTED to move): fullscreen on/off, panel
 * resize, board/Orca view switch and back, panel close+reopen, CARD switch while the panel stays
 * open (the newly-named case), and SESSION switch on the first card (this phase's central claim —
 * zero new mount events, `PANEL-03` preserved verbatim).
 *
 * METHODOLOGY TRAP inherited from Phase 55/`92-06`: in Board (overlay) mode a full-viewport
 * click-outside backdrop intercepts a raw click at a card's coordinates and closes the panel before
 * the click reaches the card — but ONLY while the panel is already open. The very first card
 * selection and the close+reopen step both start from a CLOSED panel (backdrop `pointerEvents:
 * none`), so a direct Board-mode card click is safe there. Only the CARD-SWITCH step (panel already
 * open, selecting a DIFFERENT card) is driven through Orca/docked mode, where there is no backdrop
 * at all. Fullscreen and the resize handle are conversely `docked`-mode UNAVAILABLE (`DetailPanel`
 * forces `fullscreen` off and never renders the resize handle while `docked`), so those two steps
 * run in Board mode by construction — this file never fabricates a scenario the real UI cannot
 * reach.
 *
 * Usage:
 *   node scripts/panel-mount-92.mjs                    the real check: expando + local-port signal,
 *                                                       exits non-zero on any violation.
 *   node scripts/panel-mount-92.mjs --dead-signal-demo  Task 2's second break: the SAME six steps,
 *                                                       but the local-port comparison is replaced by
 *                                                       the (constant) server pid and evaluated with
 *                                                       NO card/session-switch exception — the naive
 *                                                       single signal Phase 55's recipe would read if
 *                                                       reused unmodified. Never gates on the expando
 *                                                       reading (printed for reference only), so a
 *                                                       real remount this mode is blind to still
 *                                                       shows up in the printed table even as the
 *                                                       run exits 0.
 *
 * Exit codes: 0 every check PASS. 1 a live :4700, a failed build, a sandbox-safety violation, an
 * interaction step whose DOM could not be found, any mount-signal violation, the real board.db
 * changing, or a sandbox/tmux/ttyd/Chrome resource still held after teardown.
 */
import { spawn, execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import {
  existsSync,
  mkdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir, homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const execFileP = promisify(execFile);

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST_ENTRY = join(REPO_ROOT, "dist", "server", "bootstrap", "index.js");
const BUILD_SCRIPT = "build";

/** Distinct from every other Phase 92 instrument's sandbox/CDP ports, per the plan's own PORTS note. */
const SANDBOX_PORT = 47865;
const CDP_PORT = 9368;
const SANDBOX_PREFIX = "dispatch-panel-mount-92-";
const TMUX_PREFIX = `dsp92pm-${process.pid}-`;
const DISPATCH_DIR_NAME = ".dispatch";

/**
 * `spawnTtyd`'s (`ttyd.ts`) exact re-adoption fingerprint key at the CURRENT runtime revision — a
 * ttyd spawned with the wrong key is classified incompatible and swept, never adopted into `procs`,
 * which would leave `getLiveTtydPort` blind to every session this harness seeds.
 */
const TTYD_REVISION_RETAINED_KEY = "DISPATCH_TTYD_REVISION_6";

const FAKE_LINEAR_API_KEY = "panel-mount-92-harness-fake-key-never-real";

const POLL_INTERVAL_MS = 100;
const READY_TIMEOUT_MS = 30_000;
const KILL_TIMEOUT_MS = 5_000;
const PORT_PARSE_TIMEOUT_MS = 10_000;
const LISTEN_POLL_TIMEOUT_MS = 10_000;
const RENDER_TIMEOUT_MS = 15_000;
/** Bounded poll for a WS reconnect to settle — matches `session-liveness-v3.mjs`'s MEASURED `SOCKET_TEARDOWN_POLL_MS` (max observed 14ms on this machine), floored generously since this instrument polls TO a connected state rather than to zero. */
const CONNECT_POLL_TIMEOUT_MS = 5_000;
const VIEWPORT = { width: 1440, height: 960 };

const CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

const CARD_A_ID = "panel-mount-a";
const CARD_B_ID = "panel-mount-b";
const CARD_A_IDENTIFIER = "PMOUNT-A";
const CARD_B_IDENTIFIER = "PMOUNT-B";

/** The one-time tag this instrument stamps on the iframe node — read back, never re-set, after baseline. */
const EXPANDO_KEY = "__panelMount92";
const EXPANDO_TAG = `panel-mount-92-${randomUUID()}`;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Fail-closed: throw (never degrade) if anything answers on the user's real dispatch port. */
async function assertNoLiveService() {
  try {
    const res = await fetch("http://127.0.0.1:4700/api/board");
    await res.body?.cancel().catch(() => {});
    throw new Error(
      "PANEL-MOUNT-92-LIVE: a live dispatch service answered on http://127.0.0.1:4700/api/board — " +
        "refusing to start real tmux/ttyd or boot a sandbox server while the user's real service " +
        "is up (its boot-time reconcile pass sweeps ttyd machine-wide). Stop the launchd service " +
        "first, then rerun.",
    );
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("PANEL-MOUNT-92-LIVE"))
      throw err;
  }
}

function assertSandboxSafe(home) {
  if (SANDBOX_PORT === 4700) {
    throw new Error(
      "SANDBOX_PORT must never equal 4700 — that is the user's live dispatch instance.",
    );
  }
  if (home === homedir()) {
    throw new Error(
      "sandbox home must never equal the real $HOME — refusing to proceed.",
    );
  }
  if (!home.startsWith(tmpdir())) {
    throw new Error(
      `sandbox home ${home} must live under ${tmpdir()} — refusing to proceed.`,
    );
  }
  if (!basename(home).startsWith(SANDBOX_PREFIX)) {
    throw new Error(
      `sandbox home ${home} must have a basename starting with "${SANDBOX_PREFIX}" — refusing to proceed.`,
    );
  }
}

function makeSandboxHome(label) {
  const home = join(tmpdir(), `${SANDBOX_PREFIX}${label}-${process.pid}`);
  assertSandboxSafe(home);
  const dispatchDir = join(home, DISPATCH_DIR_NAME);
  mkdirSync(dispatchDir, { recursive: true });
  writeFileSync(
    join(dispatchDir, "config.json"),
    JSON.stringify(
      {
        port: SANDBOX_PORT,
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

let serverBuild = null;

/**
 * Unconditional full `build` (web + server) — this instrument reads rendered DOM through a real
 * browser, so a server-only build is not enough. Never mtime-gated, matching `panel-92.mjs`'s own
 * rationale: `tsc`/esbuild can leave an emitted file untouched when its text is unchanged, and this
 * repo is comment-dense enough that a comment-only edit would trip an mtime guard no rebuild could
 * clear.
 */
function assertBuilt() {
  if (serverBuild !== null) return serverBuild;
  const startedAt = Date.now();
  try {
    execFileSync("npm", ["run", BUILD_SCRIPT], {
      cwd: REPO_ROOT,
      stdio: "pipe",
    });
  } catch (err) {
    const detail = [err.stdout?.toString(), err.stderr?.toString()]
      .filter(Boolean)
      .join("\n")
      .trim();
    throw new Error(
      `refusing to run — \`npm run ${BUILD_SCRIPT}\` failed, so dist/ does not reflect src/:\n${detail || err.message}`,
    );
  }
  if (!existsSync(DIST_ENTRY)) {
    throw new Error(
      `Missing ${DIST_ENTRY} after a successful \`npm run ${BUILD_SCRIPT}\`.`,
    );
  }
  serverBuild = { durationMs: Date.now() - startedAt };
  console.log(
    `preflight: built src/ -> dist/ via \`npm run ${BUILD_SCRIPT}\` in ${serverBuild.durationMs}ms`,
  );
  return serverBuild;
}

function bootServer(home) {
  assertBuilt();
  const child = spawn("node", [DIST_ENTRY], {
    env: { ...process.env, HOME: home, NODE_ENV: "production" },
    stdio: ["ignore", "ignore", "ignore"],
  });
  return child;
}

/** `tmux new-session -d -s <name> -c <cwd>` running a trivial long-lived shell loop — never `claude`. */
async function tmuxNewSession(name, cwd) {
  mkdirSync(cwd, { recursive: true });
  await execFileP("tmux", [
    "new-session",
    "-d",
    "-s",
    name,
    "-c",
    cwd,
    "sh",
    "-c",
    "while true; do sleep 3600; done",
  ]);
}

async function tmuxKillSession(name) {
  try {
    await execFileP("tmux", ["kill-session", "-t", name]);
  } catch {
    // already gone — idempotent teardown
  }
}

async function tmuxListSessionNames() {
  try {
    const { stdout } = await execFileP("tmux", [
      "list-sessions",
      "-F",
      "#{session_name}",
    ]);
    return stdout.split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

/** `lsof -nP -iTCP:<port> -sTCP:LISTEN`, tolerant of lsof's non-zero exit on no match. */
async function isPortListening(port) {
  try {
    await execFileP("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"]);
    return true;
  } catch {
    return false;
  }
}

async function waitForPortListening(port, timeoutMs = LISTEN_POLL_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isPortListening(port)) return;
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(
    `port ${port} never reported LISTENING via lsof within ${timeoutMs}ms`,
  );
}

/**
 * `lsof -nP -iTCP:<port> -sTCP:ESTABLISHED -Fpn` scoped to `pid`, parsing the LOCAL half of each
 * `local->remote` NAME row — the repo's own `countEstablishedToPort` idiom
 * (`session-liveness-v3.mjs`), extended here to return the parsed local port(s) rather than just a
 * count, since the LOCAL port is this file's own identity signal (see file header). Tolerant of
 * lsof's non-zero exit on no match.
 */
async function establishedLocalPorts(port, pid) {
  try {
    const { stdout } = await execFileP("lsof", [
      "-nP",
      `-iTCP:${port}`,
      "-sTCP:ESTABLISHED",
      "-Fpn",
    ]);
    let currentPid = null;
    const endpoints = [];
    for (const line of stdout.split("\n")) {
      if (line.startsWith("p")) {
        currentPid = Number(line.slice(1));
      } else if (line.startsWith("n") && currentPid === pid) {
        endpoints.push(line.slice(1));
      }
    }
    const localPorts = endpoints
      .map((e) => e.match(/^[^:]*:(\d+)->/))
      .filter(Boolean)
      .map((m) => Number(m[1]));
    return { count: endpoints.length, endpoints, localPorts };
  } catch {
    return { count: 0, endpoints: [], localPorts: [] };
  }
}

/**
 * Poll {@link establishedLocalPorts} until exactly one ESTABLISHED row is owned by `pid` on
 * `port`, returning its local port. This both confirms "the iframe is connected" (the measurement
 * protocol's own precondition) and is how every per-step reading is taken — a check that reads
 * `lsof` exactly once, immediately after an action, is exactly the instantaneous-read trap
 * `92-RESEARCH.md` Pitfall 2 warns against; the teardown/reconnect side is event-driven with no
 * artificial delay but is not therefore zero-elapsed-time.
 */
async function pollForSingleEstablished(
  port,
  pid,
  timeoutMs = CONNECT_POLL_TIMEOUT_MS,
) {
  const deadline = Date.now() + timeoutMs;
  let last = { count: 0, endpoints: [], localPorts: [] };
  while (Date.now() < deadline) {
    last = await establishedLocalPorts(port, pid);
    if (last.count === 1) return { ...last, localPort: last.localPorts[0] };
    await sleep(20);
  }
  return { ...last, localPort: last.localPorts[0] ?? null };
}

/**
 * Spawn one real ttyd with the EXACT argv `spawnTtyd` (`ttyd.ts`) uses at the current runtime
 * revision, `-b /sessions/<sessionId>/terminal` session-keyed (PROXY-01). `sessionId` must be
 * minted BEFORE this call and persisted onto the SAME session record the fixture seeds — spawning
 * with one id and persisting another leaves the record's proxy path pointing at a ttyd that never
 * used it.
 */
function spawnTtyd(tmuxName, sessionId) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "ttyd",
      [
        "-W",
        "-i",
        "127.0.0.1",
        "-p",
        "0",
        "-b",
        `/sessions/${sessionId}/terminal`,
        "-t",
        "disableLeaveAlert=true",
        "-t",
        `${TTYD_REVISION_RETAINED_KEY}=1`,
        "tmux",
        "-u",
        "attach",
        "-t",
        `=${tmuxName}`,
      ],
      { detached: true, stdio: ["ignore", "ignore", "pipe"] },
    );
    let buf = "";
    const timer = setTimeout(() => {
      reject(
        new Error(
          `ttyd port not reported within ${PORT_PARSE_TIMEOUT_MS}ms for ${tmuxName}`,
        ),
      );
    }, PORT_PARSE_TIMEOUT_MS);
    const onData = (d) => {
      buf += d.toString();
      const m = buf.match(/Listening on port:\s*(\d+)/);
      if (m) {
        clearTimeout(timer);
        child.stderr?.off("data", onData);
        child.unref();
        resolve({ child, port: Number(m[1]) });
      }
    };
    child.stderr?.on("data", onData);
    child.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(
        new Error(`ttyd exited early (code ${code}) for ${tmuxName}: ${buf}`),
      );
    });
  });
}

function makeSessionRecord(
  home,
  tmuxName,
  ttydPort,
  sessionId,
  createdAtOffsetMs,
) {
  const createdAt = new Date(Date.now() - createdAtOffsetMs).toISOString();
  return {
    id: sessionId,
    createdAt,
    updatedAt: createdAt,
    tmuxSession: tmuxName,
    ttydPort,
    hookToken: randomBytes(32).toString("hex"),
    workspacePath: join(home, "workspaces", tmuxName),
  };
}

function seedFixtureCard(home, card) {
  const dbPath = join(home, DISPATCH_DIR_NAME, "board.db");
  const db = new DatabaseSync(dbPath);
  try {
    db.exec("BEGIN");
    db.prepare(
      `INSERT INTO cards (id, data) VALUES (?, ?)
       ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
    ).run(card.id, JSON.stringify(card));
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  } finally {
    db.close();
  }
}

function statFile(path) {
  try {
    const st = statSync(path);
    return { exists: true, mtimeMs: st.mtimeMs, size: st.size };
  } catch {
    return { exists: false, mtimeMs: null, size: null };
  }
}

function statRealBoardDb() {
  const p = join(homedir(), DISPATCH_DIR_NAME, "board.db");
  return { path: p, ...statFile(p) };
}

function fmtStat(s) {
  return s.exists ? `mtimeMs=${s.mtimeMs} size=${s.size}` : "(absent)";
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

/** Poll `#root`'s text content until every fixture identifier has rendered somewhere. */
async function waitForBoardRootLoaded(cdp, sessionId, identifiers) {
  const deadline = Date.now() + RENDER_TIMEOUT_MS;
  const probe = `
    (function () {
      var root = document.getElementById("root");
      if (!root) return false;
      var text = root.textContent;
      return ${JSON.stringify(identifiers)}.every(function (id) { return text.indexOf(id) !== -1; });
    })()
  `;
  while (Date.now() < deadline) {
    try {
      if (await evalValue(cdp, sessionId, probe)) return;
    } catch {
      // page mid-navigation — keep polling
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(
    `initial board load never rendered every identifier ${identifiers.join(", ")} within ${RENDER_TIMEOUT_MS}ms`,
  );
}

/**
 * Click the Board-mode card tile whose identifier text matches, via a real `.click()` on the
 * SMALLEST (leaf) element containing exactly that text — the native click bubbles through every
 * ancestor including the card's real `onClick`, the same technique `panel-92.mjs`'s Orca nav click
 * uses. Safe in Board mode ONLY while the panel is currently CLOSED (no click-outside backdrop
 * intercepts anything when nothing is open) — never call this while a DIFFERENT card's panel is
 * open; use {@link selectCardViaOrcaNav} for that (the Phase 55 trap).
 */
async function clickBoardCard(cdp, sessionId, identifier) {
  const clickExpr = `
    (function () {
      var leaves = Array.prototype.filter.call(document.querySelectorAll("body *"), function (el) {
        return el.children.length === 0 && el.textContent.trim() === "${identifier}";
      });
      if (leaves.length === 0) throw new Error("no board card leaf matched ${identifier}");
      leaves[0].click();
      return true;
    })()
  `;
  await evalValue(cdp, sessionId, clickExpr);
  await waitForAsideShowing(cdp, sessionId, identifier);
}

async function waitForAsideShowing(cdp, sessionId, identifier) {
  const probe = `
    (function () {
      var aside = document.querySelector('aside[aria-label="Ticket detail"]');
      if (!aside) return false;
      return aside.textContent.indexOf("${identifier}") !== -1;
    })()
  `;
  const deadline = Date.now() + RENDER_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await evalValue(cdp, sessionId, probe)) return;
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(
    `panel never showed ${identifier} within ${RENDER_TIMEOUT_MS}ms`,
  );
}

/** Docked/Orca nav click — the Phase 55/`92-06` trap-free way to select a DIFFERENT card while the panel is already open. */
async function selectCardViaOrcaNav(cdp, sessionId, identifier) {
  const clickExpr = `
    (function () {
      var nav = document.querySelector('nav[aria-label="Tickets"]');
      if (!nav) throw new Error("Orca nav not found");
      var rows = Array.prototype.filter.call(
        nav.querySelectorAll('[role="button"]'),
        function (el) { return el.textContent.indexOf("${identifier}") !== -1; },
      );
      if (rows.length === 0) throw new Error("no Orca nav row matched ${identifier}");
      if (rows.length > 1) throw new Error("Orca nav row matched ${identifier} " + rows.length + " times");
      rows[0].click();
      return true;
    })()
  `;
  await evalValue(cdp, sessionId, clickExpr);
  await waitForAsideShowing(cdp, sessionId, identifier);
}

/** Click the "View" segmented control's `aria-label="Board view"` / `"Orca view"` button (`SyncStrip.tsx`) — the real in-app SPA toggle (a `setViewMode` state change, never a `Page.reload`/`localStorage` injection), since a full navigation destroys the whole document — including this file's own expando tag — regardless of PANEL-03, which is a harness artifact, not a remount the fence is about. */
async function clickViewModeButton(cdp, sessionId, label) {
  const expr = `
    (function () {
      var group = document.querySelector('[role="group"][aria-label="View"]');
      if (!group) throw new Error("View mode group not found");
      var btn = Array.prototype.find.call(group.querySelectorAll("button"), function (b) {
        return b.getAttribute("aria-label") === ${JSON.stringify(label)};
      });
      if (!btn) throw new Error("no View button with aria-label " + ${JSON.stringify(label)});
      btn.click();
      return true;
    })()
  `;
  await evalValue(cdp, sessionId, expr);
}

async function waitForDocked(cdp, sessionId, expectDocked, identifier) {
  const probe = `
    (function () {
      var aside = document.querySelector('aside[aria-label="Ticket detail"]');
      if (!aside) return false;
      var docked = aside.style.transform === "none";
      return docked === ${expectDocked ? "true" : "false"} && aside.textContent.indexOf("${identifier}") !== -1;
    })()
  `;
  const deadline = Date.now() + RENDER_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await evalValue(cdp, sessionId, probe)) return;
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(
    `panel never reached docked=${expectDocked} showing ${identifier} within ${RENDER_TIMEOUT_MS}ms`,
  );
}

/** Set the one-time expando on the currently-mounted terminal iframe. Called exactly ONCE, before the baseline capture — never re-set, since re-setting after every step would hide a remount. */
async function setExpando(cdp, sessionId) {
  const expr = `
    (function () {
      var iframe = document.querySelector('aside[aria-label="Ticket detail"] iframe');
      if (!iframe) throw new Error("terminal iframe not found to tag");
      iframe["${EXPANDO_KEY}"] = ${JSON.stringify(EXPANDO_TAG)};
      return true;
    })()
  `;
  await evalValue(cdp, sessionId, expr);
}

/** Read the expando back. `null` (element present, property missing/different) or `"NO_IFRAME"` (no iframe element at all right now) both count as "gone" — a remount OR a transient no-iframe state are both worth surfacing distinctly in the printed table. */
async function readExpando(cdp, sessionId) {
  const expr = `
    (function () {
      var iframe = document.querySelector('aside[aria-label="Ticket detail"] iframe');
      if (!iframe) return "NO_IFRAME";
      var v = iframe["${EXPANDO_KEY}"];
      return v === undefined ? null : v;
    })()
  `;
  return evalValue(cdp, sessionId, expr);
}

/** Click the fullscreen toggle in `PanelHeader` (`aria-label="Enter fullscreen"` / `"Exit fullscreen"`). */
async function clickFullscreenToggle(cdp, sessionId, entering) {
  const label = entering ? "Enter fullscreen" : "Exit fullscreen";
  const expr = `
    (function () {
      var btn = document.querySelector('button[aria-label="${label}"]');
      if (!btn) throw new Error('fullscreen button "${label}" not found');
      btn.click();
      return true;
    })()
  `;
  await evalValue(cdp, sessionId, expr);
  await sleep(250);
}

/** Click "Close panel" in `PanelHeader`. */
async function clickClosePanel(cdp, sessionId) {
  const expr = `
    (function () {
      var btn = document.querySelector('button[aria-label="Close panel"]');
      if (!btn) throw new Error('"Close panel" button not found');
      btn.click();
      return true;
    })()
  `;
  await evalValue(cdp, sessionId, expr);
}

/**
 * Drag the resize handle (`role="separator"` `aria-label="Resize panel"`) via real CDP mouse
 * events (`Input.dispatchMouseEvent` — the browser's own input pipeline, which Chrome maps to
 * native `PointerEvent`s exactly as a real mouse would, satisfying both the handle's own
 * `onPointerDown` and the app's `window`-level `pointermove`/`pointerup` listeners). Moves LEFT
 * (widening the panel) by 80px, well past the 3px tap threshold that would otherwise treat this as
 * a no-op click.
 */
async function dragResizeHandle(cdp, sessionId) {
  const rect = await evalValue(
    cdp,
    sessionId,
    `
    (function () {
      var handle = document.querySelector('[aria-label="Resize panel"]');
      if (!handle) throw new Error("resize handle not found");
      var r = handle.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()
  `,
  );
  const x0 = rect.x;
  const y = rect.y;
  const x1 = x0 - 80;
  await cdp.send(
    "Input.dispatchMouseEvent",
    {
      type: "mousePressed",
      x: x0,
      y,
      button: "left",
      buttons: 1,
      clickCount: 1,
    },
    sessionId,
  );
  for (const frac of [0.25, 0.5, 0.75, 1]) {
    await cdp.send(
      "Input.dispatchMouseEvent",
      { type: "mouseMoved", x: x0 + (x1 - x0) * frac, y, buttons: 1 },
      sessionId,
    );
    await sleep(20);
  }
  await cdp.send(
    "Input.dispatchMouseEvent",
    {
      type: "mouseReleased",
      x: x1,
      y,
      button: "left",
      buttons: 0,
      clickCount: 1,
    },
    sessionId,
  );
  await sleep(150);
}

/** Click the switcher segment with the given `aria-label` (`SessionSwitcher.tsx`, e.g. "Session 2"). */
async function clickSwitcherSegment(cdp, sessionId, label) {
  const expr = `
    (function () {
      var aside = document.querySelector('aside[aria-label="Ticket detail"]');
      var group = aside && aside.querySelector('[role="group"][aria-label="Sessions"]');
      if (!group) throw new Error("switcher group not found to click");
      var btn = Array.prototype.find.call(group.querySelectorAll("button"), function (b) {
        return b.getAttribute("aria-label") === ${JSON.stringify(label)};
      });
      if (!btn) throw new Error("no segment with aria-label ${label}");
      btn.click();
      return true;
    })()
  `;
  await evalValue(cdp, sessionId, expr);
}

/**
 * Take one reading: the expando (unconditionally) and the local-port identity for `activePort`
 * (the ttyd port the CURRENTLY-DISPLAYED session should be connected through). In
 * `--dead-signal-demo` mode the local-port VALUE reported is the constant server pid instead —
 * same shape, deliberately dead signal, so the printed table/violation logic never needs a second
 * code path.
 */
async function takeReading(cdp, sessionId, activePort, serverPid, demoMode) {
  const expando = await readExpando(cdp, sessionId);
  const est = await pollForSingleEstablished(activePort, serverPid);
  const identity = demoMode
    ? String(serverPid)
    : est.localPort != null
      ? String(est.localPort)
      : null;
  return {
    expando,
    establishedCount: est.count,
    localPort: est.localPort,
    identity,
  };
}

function readFlag(argv, name) {
  return argv.includes(name);
}

async function checkPortsHeld() {
  try {
    const args = [SANDBOX_PORT, CDP_PORT].flatMap((p) => ["-i", `:${p}`]);
    const { stdout } = await execFileP("lsof", args).catch((err) => ({
      stdout: err.stdout ?? "",
    }));
    const held = stdout.trim() !== "";
    if (held)
      console.error(
        `ASSERTION: sandbox ports still held after teardown:\n${stdout}`,
      );
    return held;
  } catch {
    return false;
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const demoMode = readFlag(argv, "--dead-signal-demo");

  await assertNoLiveService();
  assertBuilt();

  const preflightTmux = (await tmuxListSessionNames()).filter((n) =>
    n.startsWith(TMUX_PREFIX),
  );
  if (preflightTmux.length > 0) {
    throw new Error(
      `refusing to start — tmux sessions already present with prefix "${TMUX_PREFIX}": ${preflightTmux.join(", ")}`,
    );
  }
  if (await isPortListening(SANDBOX_PORT)) {
    throw new Error(
      `refusing to start — something is already LISTENING on sandbox port ${SANDBOX_PORT}`,
    );
  }

  const realBefore = statRealBoardDb();
  console.log(`LIVE ${realBefore.path} BEFORE: ${fmtStat(realBefore)}`);

  const home = makeSandboxHome(`run-${process.pid}`);
  const tmuxNames = {
    a1: `${TMUX_PREFIX}a1`,
    a2: `${TMUX_PREFIX}a2`,
    b1: `${TMUX_PREFIX}b1`,
  };
  const ttyd = {};
  let server = null;
  let chromeChild = null;
  let cdp = null;
  let readings = [];
  let violations = [];
  let portsHeld = false;

  try {
    // Warmup boot against the still-cardless sandbox home to create the sqlite schema first —
    // reconcileSessions() at the REAL boot below needs the fixture cards already seeded, or it
    // resolves an empty candidate set and sweeps every ttyd this harness is about to spawn as an
    // unrecognized orphan (the same ordering hazard `session-liveness-v3.mjs` documents).
    const warmup = bootServer(home);
    await waitForReady(SANDBOX_PORT);
    await killAndWait(warmup);

    for (const key of Object.keys(tmuxNames)) {
      await tmuxNewSession(
        tmuxNames[key],
        join(home, "workspaces", tmuxNames[key]),
      );
    }
    const liveTmux = await tmuxListSessionNames();
    const missingTmux = Object.values(tmuxNames).filter(
      (n) => !liveTmux.includes(n),
    );
    if (missingTmux.length > 0) {
      throw new Error(
        `tmux sessions did not all come up: missing ${missingTmux.join(", ")}`,
      );
    }
    console.log(
      `standup: tmux sessions live — ${Object.values(tmuxNames).join(", ")}`,
    );

    const sessionIds = { a1: randomUUID(), a2: randomUUID(), b1: randomUUID() };
    for (const key of Object.keys(tmuxNames)) {
      ttyd[key] = await spawnTtyd(tmuxNames[key], sessionIds[key]);
    }
    for (const key of Object.keys(tmuxNames)) {
      await waitForPortListening(ttyd[key].port);
    }
    console.log(
      `standup: ttyd ports LISTENING — ${Object.keys(tmuxNames)
        .map((k) => `${k}=${ttyd[k].port}`)
        .join(", ")}`,
    );

    const recA1 = makeSessionRecord(
      home,
      tmuxNames.a1,
      ttyd.a1.port,
      sessionIds.a1,
      4000,
    );
    const recA2 = makeSessionRecord(
      home,
      tmuxNames.a2,
      ttyd.a2.port,
      sessionIds.a2,
      2000,
    );
    const recB1 = makeSessionRecord(
      home,
      tmuxNames.b1,
      ttyd.b1.port,
      sessionIds.b1,
      3000,
    );
    const now = new Date().toISOString();

    const cardA = {
      id: CARD_A_ID,
      issueId: `${CARD_A_ID}-issue`,
      identifier: CARD_A_IDENTIFIER,
      title: "panel-mount-92 fixture card A — two real sessions",
      description: null,
      priority: 3,
      column: "in_progress",
      updatedAt: now,
      sessions: [recA1, recA2],
      activeSessionId: recA1.id,
      tmuxSession: recA1.tmuxSession,
      ttydPort: recA1.ttydPort,
      hookToken: recA1.hookToken,
      workspacePath: recA1.workspacePath,
    };
    const cardB = {
      id: CARD_B_ID,
      issueId: `${CARD_B_ID}-issue`,
      identifier: CARD_B_IDENTIFIER,
      title: "panel-mount-92 fixture card B — one real session",
      description: null,
      priority: 3,
      column: "in_progress",
      updatedAt: now,
      sessions: [recB1],
      activeSessionId: recB1.id,
      tmuxSession: recB1.tmuxSession,
      ttydPort: recB1.ttydPort,
      hookToken: recB1.hookToken,
      workspacePath: recB1.workspacePath,
    };
    seedFixtureCard(home, cardA);
    seedFixtureCard(home, cardB);

    server = bootServer(home);
    await waitForReady(SANDBOX_PORT);
    const serverPid = server.pid;
    console.log(
      `standup: sandbox server ready on :${SANDBOX_PORT}, pid=${serverPid}`,
    );

    chromeChild = spawn(
      findChrome(),
      [
        "--headless=new",
        `--remote-debugging-port=${CDP_PORT}`,
        `--user-data-dir=${join(tmpdir(), `${SANDBOX_PREFIX}chrome-${process.pid}`)}`,
        "--no-first-run",
      ],
      { stdio: ["ignore", "ignore", "ignore"] },
    );
    await waitForCdpUp();

    cdp = await connectCDP();
    const { targetId } = await cdp.send("Target.createTarget", {
      url: `http://127.0.0.1:${SANDBOX_PORT}/`,
    });
    const { sessionId } = await cdp.send("Target.attachToTarget", {
      targetId,
      flatten: true,
    });
    await cdp.send("Page.enable", {}, sessionId);
    await cdp.send("Runtime.enable", {}, sessionId);
    await cdp.send(
      "Emulation.setDeviceMetricsOverride",
      {
        width: VIEWPORT.width,
        height: VIEWPORT.height,
        deviceScaleFactor: 1,
        mobile: false,
      },
      sessionId,
    );

    // Default view mode is "board" (localStorage unset) — panel starts CLOSED, so this first
    // click is safe even in Board/overlay mode (the click-outside backdrop only intercepts
    // clicks while a DIFFERENT card's panel is already open).
    await waitForBoardRootLoaded(cdp, sessionId, [
      CARD_A_IDENTIFIER,
      CARD_B_IDENTIFIER,
    ]);
    await clickBoardCard(cdp, sessionId, CARD_A_IDENTIFIER);
    console.log("standup: opened card A's panel in Board (non-docked) mode");

    const baselineConnect = await pollForSingleEstablished(
      recA1.ttydPort,
      serverPid,
    );
    if (baselineConnect.count !== 1) {
      throw new Error(
        `precondition violated — expected exactly 1 ESTABLISHED row on session A1's ttyd port ${recA1.ttydPort} owned by pid ${serverPid} before measuring, actual ${baselineConnect.count}. A 0 reading here means the instrument itself is blind, not that the terminal never connected.`,
      );
    }
    await setExpando(cdp, sessionId);
    const baseline = await takeReading(
      cdp,
      sessionId,
      recA1.ttydPort,
      serverPid,
      demoMode,
    );
    if (baseline.expando !== EXPANDO_TAG) {
      throw new Error(
        `precondition violated — expando readback immediately after tagging was ${JSON.stringify(baseline.expando)}, expected ${JSON.stringify(EXPANDO_TAG)}`,
      );
    }
    console.log(
      `BASELINE: expando=${baseline.expando} localPort=${baseline.localPort} identity=${baseline.identity}`,
    );

    const record = (
      label,
      reading,
      expectExpandoIntact,
      expectIdentityUnchanged,
    ) => {
      const rowViolations = [];
      if (expectExpandoIntact && reading.expando !== EXPANDO_TAG) {
        rowViolations.push(
          `${label}: expando expected intact (${EXPANDO_TAG}), got ${JSON.stringify(reading.expando)} — the iframe element was REMOUNTED`,
        );
      }
      if (
        expectIdentityUnchanged === true &&
        reading.identity !== baseline.identity
      ) {
        rowViolations.push(
          `${label}: identity expected UNCHANGED from baseline (${baseline.identity}), got ${reading.identity}`,
        );
      }
      readings.push({ label, ...reading, rowViolations });
      violations.push(...rowViolations);
      for (const v of rowViolations) console.log(`VIOLATION ${v}`);
      return reading;
    };

    // Step 1: fullscreen on, then off — Board/non-docked mode only (docked forces fullscreen off).
    await clickFullscreenToggle(cdp, sessionId, true);
    await clickFullscreenToggle(cdp, sessionId, false);
    record(
      "1-fullscreen",
      await takeReading(cdp, sessionId, recA1.ttydPort, serverPid, demoMode),
      true,
      true,
    );

    // Step 2: panel resize via the drag handle — Board/non-docked mode only (docked never renders it).
    await dragResizeHandle(cdp, sessionId);
    record(
      "2-resize",
      await takeReading(cdp, sessionId, recA1.ttydPort, serverPid, demoMode),
      true,
      true,
    );

    // Step 3: Board/Orca view switch, and back.
    await clickViewModeButton(cdp, sessionId, "Orca view");
    await waitForDocked(cdp, sessionId, true, CARD_A_IDENTIFIER);
    const atOrca = await takeReading(
      cdp,
      sessionId,
      recA1.ttydPort,
      serverPid,
      demoMode,
    );
    await clickViewModeButton(cdp, sessionId, "Board view");
    await waitForDocked(cdp, sessionId, false, CARD_A_IDENTIFIER);
    const backAtBoard = await takeReading(
      cdp,
      sessionId,
      recA1.ttydPort,
      serverPid,
      demoMode,
    );
    {
      const rowViolations = [];
      for (const [sub, r] of [
        ["at-orca", atOrca],
        ["back-at-board", backAtBoard],
      ]) {
        if (r.expando !== EXPANDO_TAG)
          rowViolations.push(
            `3-orca-view-switch(${sub}): expando expected intact, got ${JSON.stringify(r.expando)} — REMOUNTED`,
          );
        if (r.identity !== baseline.identity)
          rowViolations.push(
            `3-orca-view-switch(${sub}): identity expected UNCHANGED from baseline (${baseline.identity}), got ${r.identity}`,
          );
      }
      readings.push({
        label: "3-orca-view-switch",
        ...backAtBoard,
        rowViolations,
      });
      violations.push(...rowViolations);
      for (const v of rowViolations) console.log(`VIOLATION ${v}`);
    }

    // Step 4: panel close, then re-open on the SAME card, fast enough to stay inside the
    // ~200ms deferred-unmount window (DetailPanel.tsx / PANEL-03's ONE intentional-unmount case,
    // which only fires once the panel has genuinely left the viewport for a while — reopening
    // promptly is the common, must-not-remount usage this step actually tests).
    await clickClosePanel(cdp, sessionId);
    await sleep(60);
    await clickBoardCard(cdp, sessionId, CARD_A_IDENTIFIER);
    record(
      "4-close-reopen",
      await takeReading(cdp, sessionId, recA1.ttydPort, serverPid, demoMode),
      true,
      true,
    );

    // Step 5: card switch while the panel stays open — the case PANEL-03's own text protects,
    // newly named by this phase. Driven through Orca/docked mode (Phase 55 trap): Board mode's
    // click-outside backdrop would intercept a raw click at card B's coordinates while card A's
    // panel is already open, closing the panel instead of switching cards.
    // @remarks Reached via the real in-app "Orca view" button (the SAME SPA-internal toggle step
    // 3 already exercised), never `switchToOrcaViaReload`'s `Page.reload` — a full navigation
    // destroys the whole document (and the expando with it) regardless of PANEL-03, which is a
    // harness artifact, not a remount this phase's fence is about. Confirmed by reproduction: an
    // earlier version of this file used the reload helper here and reported a false "REMOUNTED"
    // at both card-switch and session-switch even against the correct, unkeyed product code.
    await clickViewModeButton(cdp, sessionId, "Orca view");
    await waitForDocked(cdp, sessionId, true, CARD_A_IDENTIFIER);
    await selectCardViaOrcaNav(cdp, sessionId, CARD_B_IDENTIFIER);
    const atCardB = await takeReading(
      cdp,
      sessionId,
      recB1.ttydPort,
      serverPid,
      demoMode,
    );
    await selectCardViaOrcaNav(cdp, sessionId, CARD_A_IDENTIFIER);
    const backAtCardA = await takeReading(
      cdp,
      sessionId,
      recA1.ttydPort,
      serverPid,
      demoMode,
    );
    {
      const rowViolations = [];
      if (atCardB.expando !== EXPANDO_TAG)
        rowViolations.push(
          `5-card-switch(at-card-b): expando expected intact, got ${JSON.stringify(atCardB.expando)} — REMOUNTED`,
        );
      if (backAtCardA.expando !== EXPANDO_TAG)
        rowViolations.push(
          `5-card-switch(back-at-card-a): expando expected intact, got ${JSON.stringify(backAtCardA.expando)} — REMOUNTED`,
        );
      if (!demoMode) {
        // The naive/uniform-unchanged rule this file's real signal deliberately does NOT apply
        // here: a src change to a DIFFERENT card's session is a legitimate reconnect
        // (92-CONTEXT.md's corrected decision), so a changed identity is expected evidence for
        // criterion 2, never a mount-event violation. --dead-signal-demo intentionally skips this
        // whole card-switch/session-switch gate (see its own note at the call site below).
        console.log(
          `NOTE 5-card-switch: identity baseline=${baseline.identity} at-card-b=${atCardB.identity} back-at-card-a=${backAtCardA.identity} — a changed identity here is EXPECTED (src re-point), not a violation`,
        );
      }
      readings.push({
        label: "5-card-switch",
        ...backAtCardA,
        atCardB,
        rowViolations,
      });
      violations.push(...rowViolations);
      for (const v of rowViolations) console.log(`VIOLATION ${v}`);
    }

    // Step 6: SESSION switch on the first card — the phase's central claim. Still in
    // Orca/docked mode from step 5 (SessionSwitcher lives inside the panel's own DOM, above the
    // backdrop, so it is never subject to the Phase 55 trap regardless of view mode).
    await clickSwitcherSegment(cdp, sessionId, "Session 2");
    const afterSessionSwitch = await takeReading(
      cdp,
      sessionId,
      recA2.ttydPort,
      serverPid,
      demoMode,
    );
    {
      const rowViolations = [];
      if (afterSessionSwitch.expando !== EXPANDO_TAG) {
        rowViolations.push(
          `6-session-switch: expando expected intact, got ${JSON.stringify(afterSessionSwitch.expando)} — REMOUNTED`,
        );
      }
      if (!demoMode) {
        console.log(
          `NOTE 6-session-switch: identity baseline=${baseline.identity} after=${afterSessionSwitch.identity} — a changed identity here is EXPECTED (src re-point to the sibling's ttyd port), not a violation`,
        );
      }
      readings.push({
        label: "6-session-switch",
        ...afterSessionSwitch,
        rowViolations,
      });
      violations.push(...rowViolations);
      for (const v of rowViolations) console.log(`VIOLATION ${v}`);
    }

    printTable(baseline, readings, demoMode);
  } finally {
    if (cdp) cdp.close();
    await killAndWait(chromeChild);
    await killAndWait(server);
    for (const key of Object.keys(ttyd)) {
      try {
        ttyd[key].child.kill("SIGTERM");
      } catch {
        // already gone
      }
    }
    await sleep(300);
    for (const key of Object.keys(ttyd)) {
      if (await isPortListening(ttyd[key].port)) {
        console.error(
          `teardown: ttyd on port ${ttyd[key].port} (${key}) survived SIGTERM — forcing`,
        );
        try {
          const { stdout } = await execFileP("lsof", [
            "-nP",
            `-iTCP:${ttyd[key].port}`,
            "-sTCP:LISTEN",
            "-Fp",
          ]);
          for (const line of stdout.split("\n")) {
            if (line.startsWith("p"))
              process.kill(Number(line.slice(1)), "SIGKILL");
          }
        } catch {
          // nothing to kill
        }
      }
    }
    for (const key of Object.keys(tmuxNames)) {
      await tmuxKillSession(tmuxNames[key]);
    }
    rmSync(home, { recursive: true, force: true });
    rmSync(join(tmpdir(), `${SANDBOX_PREFIX}chrome-${process.pid}`), {
      recursive: true,
      force: true,
    });
    portsHeld = await checkPortsHeld();

    const leakedTmux = (await tmuxListSessionNames()).filter((n) =>
      n.startsWith(TMUX_PREFIX),
    );
    if (leakedTmux.length > 0) {
      console.error(
        `ASSERTION: leaked tmux sessions after teardown: ${leakedTmux.join(", ")}`,
      );
      portsHeld = true; // fold into the same non-zero-exit signal
    }
    for (const key of Object.keys(ttyd)) {
      if (await isPortListening(ttyd[key].port)) {
        console.error(
          `ASSERTION: ttyd port ${ttyd[key].port} (${key}) still LISTENING after teardown`,
        );
        portsHeld = true;
      }
    }
  }

  const realAfter = statRealBoardDb();
  console.log(`LIVE ${realAfter.path} AFTER: ${fmtStat(realAfter)}`);
  if (
    realBefore.exists !== realAfter.exists ||
    realBefore.mtimeMs !== realAfter.mtimeMs ||
    realBefore.size !== realAfter.size
  ) {
    console.log(
      `FAIL: the real ${realAfter.path} changed during this run — this must never happen. before=${fmtStat(realBefore)} after=${fmtStat(realAfter)}`,
    );
    process.exit(1);
  }

  if (portsHeld) {
    console.log(
      "FAIL: a sandbox resource (port/tmux/ttyd) was still held after teardown",
    );
    process.exit(1);
  }

  const gatingViolations = demoMode
    ? violations.filter((v) => v.includes("identity expected UNCHANGED"))
    : violations;

  if (gatingViolations.length > 0) {
    console.log(
      `\nFAIL: ${gatingViolations.length} violation(s)${demoMode ? " (--dead-signal-demo: expando violations are informational-only in this mode, not gating)" : ""}`,
    );
    process.exit(1);
  }

  console.log(
    `\nPASS${demoMode ? " (--dead-signal-demo: gated ONLY on the constant-pid identity signal — see the printed table for whether the expando signal independently disagreed)" : ""}`,
  );
  process.exit(0);
}

function printTable(baseline, readings, demoMode) {
  console.log(
    `\nbaseline: expando=${baseline.expando} identity=${baseline.identity}`,
  );
  console.log(
    "step                  expando-intact  identity            row-violations",
  );
  for (const r of readings) {
    const expandoIntact = r.expando === EXPANDO_TAG;
    console.log(
      `${r.label.padEnd(22)}${String(expandoIntact).padEnd(16)}${String(r.identity).padEnd(20)}${r.rowViolations.length}`,
    );
  }
  if (demoMode) {
    console.log(
      '(--dead-signal-demo: "identity" above is the constant server pid, not the local port — exit code ignores expando)',
    );
  }
}

function findChrome() {
  const found = CHROME_CANDIDATES.find((p) => existsSync(p));
  if (!found) {
    throw new Error(
      `No Chrome binary found at any known path: ${CHROME_CANDIDATES.join(", ")}`,
    );
  }
  return found;
}

async function waitForCdpUp() {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
      await res.body?.cancel();
      if (res.status === 200) return;
    } catch {
      // Chrome debugging port not up yet — keep polling
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`Chrome debugging port :${CDP_PORT} did not come up`);
}

main().catch((err) => {
  console.error(`panel-mount-92 failed: ${err.stack ?? err.message}`);
  process.exit(1);
});
