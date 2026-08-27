/**
 * Phase 110 instrument script scaffold (PUSH-02, dev/ops tooling, NOT test code): no test
 * framework, no assertion library, lives outside src/, the same category as panel-92 through
 * panel-109. `scripts/**` is eslint-ignored, so the JSDoc-only comment rule does not apply here,
 * but prettier still formats this file.
 *
 * SAFETY, copied verbatim in substance from this project's own precedent (panel-92 through
 * panel-109.mjs headers). Booting ANY dispatch server sweeps `ttyd` processes MACHINE-WIDE via
 * `adoptAndSweep`, fingerprinted by argv shape, never by tmux session name or which board.db
 * spawned it. `assertNoLiveService()` is a FAIL-CLOSED preflight: it throws (never warns) if
 * anything answers on the user's live service at :4700, before this script boots any server or
 * spawns any real process, and there is no override flag. It runs FIRST in `main()`, before any
 * sandbox directory is created.
 *
 * SCOPE, Plan 01 claims this phase's instrument script, its port triple, and its registry shape
 * with one break-proven check (`needs-input-trigger-fires`) that drives a REAL tmux pane marker
 * through the REAL watcher into a REAL sandbox `board.db`. This is the phase's one new capability
 * no prior panel script needed: every send check later plans register still needs a cheap,
 * provable way to make `applyMarker` fire `status_needs_input` for real, so that driver is proven
 * FIRST, before any send code exists to blur what is being measured. Later plans add the send
 * pipeline (VAPID crypto, subscriptions, actual push delivery) and headless-Chrome-driven checks
 * for the client side of that pipeline (service worker push handler, deep-link focus/open,
 * re-fire coalescing).
 *
 * Ports, unique against every existing `panel-*.mjs` and other `scripts/*.mjs` harness (verified
 * against every prior `panel-9x.mjs`, `panel-100.mjs`, `panel-104.mjs`, `panel-108.mjs`,
 * `panel-109.mjs`'s own claimed port pair, and every non-panel `scripts/*.mjs` harness):
 * sandbox server 47883, CDP 9381, stub push service 47884 (declared now, first used by a later
 * plan's fan-out/pruning checks). Port 4700 is the user's live service and is forbidden as a
 * sandbox port.
 *
 * Usage:
 *   node scripts/panel-110.mjs                every registered check, exits non-zero on any
 *                                                violation. Refuses to exit 0 if CHECKS is empty,
 *                                                so an accidentally emptied map can never read as
 *                                                a vacuous pass.
 *   node scripts/panel-110.mjs --check <name>  one named check only. Unknown name exits non-zero
 *                                                and lists every registered name.
 *   node scripts/panel-110.mjs --break <name>  that check's OWN break: mutates the real artifact
 *                                                the check reads, confirms the SAME check function
 *                                                the real run uses reports the violation by name
 *                                                (TRIP leg), restores the captured original
 *                                                unconditionally in a `finally`, and re-confirms a
 *                                                clean pass (RESTORE leg). Never edits a source
 *                                                file without capturing and restoring its bytes.
 *   node scripts/panel-110.mjs --probe <name>  a non-assertion measurement run. Never registered
 *                                                in CHECKS and never run by a bare invocation: a
 *                                                measurement that can report a legitimate
 *                                                non-pass verdict would make the suite's exit
 *                                                code meaningless. Unknown name exits non-zero and
 *                                                lists every registered probe name.
 *
 * Exit-code contract: 0 when every requested check reports zero violations, or when a break's
 * trip leg correctly fired and its restore leg re-passed. 1 on any violation, any safety trip
 * (`assertNoLiveService`), or a break whose trip/restore leg did not behave as expected.
 *
 * DEVIATION from `panel-109.mjs`'s `bootServerAt`: this file's `bootServerAt` pipes the child's
 * stdout and stderr instead of ignoring them, accumulating both into one bounded string (oldest
 * text dropped past roughly 1MB) exposed via a `log()` accessor alongside the child process.
 * Later checks in this phase read the sandbox server's own one-line push status logs from it,
 * and ignoring the streams (as every prior panel script does) would make that evidence
 * unreachable. Every call site in this file uses the returned `{ child, log }` shape; `stopServer`
 * still takes the raw `child`.
 *
 * BREAK EVIDENCE, appended to by every plan in this phase that registers a check. The quoted
 * lines below are the VERBATIM TRIP-leg output captured from a real `--break` run:
 *   - `needs-input-trigger-fires` proven able to fail (Plan 01): replacing the `NEEDS_INPUT`
 *     alternative inside `src/server/adapters/markers/parse.ts`'s `MARKER_RE` with a token that
 *     can never appear on a real pane, rebuilding, and re-running the same check against a real
 *     booted sandbox server and a real detached tmux pane produced, verbatim:
 *     `needs-input-trigger-fires: card did not reach column "needs_input" with statusReason
 *     "panel-110-reason-48474-1787776628585" within 15000ms, observed column "in_progress"`
 *     `needs-input-trigger-fires: no events row with type "status_needs_input" and card_id
 *     "panel-110-needs-input-trigger-fires" observed within 15000ms`
 *     The RESTORE leg re-ran clean (`--break needs-input-trigger-fires RESTORE leg: PASS`) after
 *     the captured bytes were restored, and `git diff --quiet` on `parse.ts` confirmed a
 *     byte-identical restore.
 *   - `push-envelope-decrypts` proven able to fail (Plan 04): removing the `dsaEncoding:
 *     "ieee-p1363"` option from `signVapidJwt`'s `sign()` call inside
 *     `src/server/services/domain/push-send.ts`, rebuilding, and re-running the same check
 *     against a real booted sandbox server, a real detached tmux pane, and the real stub push
 *     service produced, verbatim:
 *     `push-envelope-decrypts: expected exactly 1 stub push request within 15000ms, observed 0`
 *     `push-envelope-decrypts: no stub push request observed, cannot check its headers or body`
 *     `push-envelope-decrypts: sandbox server log never contained a line matching "[push] send
 *     201"`
 *     `signVapidJwt`'s own `signature.length !== 64` assertion throws before the request is ever
 *     sent once the signature reverts to Node's DER default (70-72 bytes, never 64), and the
 *     per-row `try/catch` in `sendPushForCard` swallows that throw and logs `[push]
 *     send-failed`, so the stub never observes a request at all. The RESTORE leg re-ran clean
 *     (`--break push-envelope-decrypts RESTORE leg: PASS`) after the captured bytes were
 *     restored, and `git diff --quiet` on `push-send.ts` confirmed a byte-identical restore.
 *   - `agent-done-no-push` proven able to fail (Plan 05): flipping `bootstrap/index.ts`'s
 *     activity listener filter from `status_needs_input` to `status_agent_done`, rebuilding, and
 *     re-running the same check against a real booted sandbox server, a real detached tmux pane,
 *     and the real stub push service produced, verbatim:
 *     `agent-done-no-push: expected zero stub push requests after an agent-done transition,
 *     observed 1`
 *     `agent-done-no-push: sandbox server log contains a "[push] send" line after an agent-done
 *     transition, expected none`
 *     The RESTORE leg re-ran clean (`--break agent-done-no-push RESTORE leg: PASS`) after the
 *     captured bytes were restored, and `git diff --quiet` on `bootstrap/index.ts` confirmed a
 *     byte-identical restore.
 *   - `multi-device-prune` proven able to fail (Plan 05): replacing the `410` literal in
 *     `push-send.ts`'s prune condition with an unreachable HTTP status number, rebuilding, and
 *     re-running the same check against a real booted sandbox server, a real detached tmux pane,
 *     and the real stub push service produced, verbatim:
 *     `multi-device-prune: endpoint /gone/dead410 (status 410) survived, expected it pruned`
 *     The RESTORE leg re-ran clean (`--break multi-device-prune RESTORE leg: PASS`) after the
 *     captured bytes were restored, and `git diff --quiet` on `push-send.ts` confirmed a
 *     byte-identical restore.
 *   - `per-origin-deep-link` proven able to fail (Plan 06): replacing the sole
 *     `deepLinkUrl(sub.origin, card.id)` call site in `push-send.ts` with a fixed literal origin
 *     for every row, rebuilding, and re-running the same check against a real booted sandbox
 *     server, a real detached tmux pane, and the real stub push service produced, verbatim:
 *     `per-origin-deep-link: /ok/loopback row's payload url uses scheme "https:", expected
 *     "http:"`
 *     `per-origin-deep-link: /ok/loopback row's payload url host is
 *     "panel-110-break-fixed-origin.example", expected "127.0.0.1:47883"`
 *     `per-origin-deep-link: /ok/tunnel row's payload url host is
 *     "panel-110-break-fixed-origin.example", expected "panel-110-tunnel-48382.trycloudflare.com"`
 *     `per-origin-deep-link: loopback and tunnel rows received the identical deep-link url
 *     "https://panel-110-break-fixed-origin.example/?card=panel-110-per-origin-deep-link",
 *     expected them to differ (a single shared origin for both rows is the failure this check
 *     exists to catch)`
 *     The RESTORE leg re-ran clean (`--break per-origin-deep-link RESTORE leg: PASS`) after the
 *     captured bytes were restored, and `git diff --quiet` on `push-send.ts` confirmed a
 *     byte-identical restore.
 *   - `deep-link-param-opens-card` proven able to fail (Plan 06): changing the parameter name the
 *     sole `params.get("card")` call site in `App.tsx`'s cold-open effect reads to a name the
 *     check never sends, rebuilding, and re-running the same check against a real booted sandbox
 *     server and real headless Chrome produced, verbatim:
 *     `deep-link-param-opens-card: detail panel never rendered the target card's identifier
 *     "PANEL-110-06b-B" within 20000ms`
 *     `deep-link-param-opens-card: window.location.search still contains "card" after the
 *     deep-link effect ran: "?card=panel-110-deep-link-card-b"`
 *     The RESTORE leg re-ran clean (`--break deep-link-param-opens-card RESTORE leg: PASS`) after
 *     the captured bytes were restored, and `git diff --quiet` on `App.tsx` confirmed a
 *     byte-identical restore.
 *   - `tag-renotify-replace` proven able to fail (Plan 07): replacing the sole `tag: data.cardId,`
 *     call site in `sw.js`'s push handler with a per-message unique tag, rebuilding, and
 *     re-running the same check against a real booted sandbox server, real headless Chrome, and
 *     a real `ServiceWorker.deliverPushMessage` delivery produced, verbatim:
 *     `tag-renotify-replace: expected exactly 1 notification tagged
 *     "panel-110-tag-renotify-card-a" after the first delivery, observed 0 ([{"tag":"panel110-
 *     break-unique-1787781270024-0.16439874646661834","title":"panel-110
 *     tag-renotify","body":"first delivery"}])`
 *     `tag-renotify-replace: expected exactly 1 notification tagged
 *     "panel-110-tag-renotify-card-a" after the second delivery (replace, not stack), observed 0
 *     (two distinctly-tagged notifications instead of one replaced notification)`
 *     `tag-renotify-replace: expected 2 notifications after delivering a DIFFERENT card (the
 *     positive control proving notifications can actually appear at all), observed 3`
 *     The RESTORE leg re-ran clean (`--break tag-renotify-replace RESTORE leg: PASS`) after the
 *     captured bytes were restored, and `git diff --quiet` on `sw.js` confirmed a byte-identical
 *     restore.
 *   - `notificationclick-focus-or-open` proven able to fail (Plan 07): emptying the sole
 *     `notificationclick` handler body in `sw.js`, rebuilding, and re-running the same check
 *     against a real booted sandbox server, real headless Chrome, and a real synthetic
 *     `NotificationEvent` dispatched inside the worker's own scope produced, verbatim:
 *     `notificationclick-focus-or-open: page never recorded a "dsp-open-card" message for
 *     "panel-110-notif-click-card-b" within 8000ms, observed []`
 *     `notificationclick-focus-or-open: detail panel never showed the clicked card's identifier
 *     "PANEL-110-07-CLICK-B" within 8000ms`
 *     `notificationclick-focus-or-open: the clicked notification tagged
 *     "panel-110-notif-click-card-b" is still listed by getNotifications() after the click,
 *     expected it closed`
 *     `notificationclick-focus-or-open: served sw.js does not call clients.openWindow(url) in
 *     its notificationclick else branch`
 *     The RESTORE leg re-ran clean (`--break notificationclick-focus-or-open RESTORE leg: PASS`)
 *     after the captured bytes were restored, and `git diff --quiet` on `sw.js` confirmed a
 *     byte-identical restore (modulo the pre-existing `try/catch` hardening around
 *     `existing.focus()`, itself a Plan 07 deviation, see the plan summary).
 *   - `needs-input-delivers` proven able to fail (Plan 08), the phase's one check judged by a real
 *     external push service rather than this repo's own stub: stripping the `k=` parameter from
 *     the Authorization header value in `push-send.ts`, rebuilding, and re-running the same check
 *     against a real booted sandbox server, a real detached tmux pane, real headless Chrome
 *     subscribing to the real push service, and a real send to that real endpoint produced,
 *     verbatim:
 *     `needs-input-delivers: attempt outcome=tier-one-failed: real push service responded 403 for
 *     endpoint prefix https://fcm.googleapis.com/fcm/send/d7-x, expected a 2xx status`
 *     `needs-input-delivers: attempt outcome=tier-one-failed: real push service responded 403 for
 *     endpoint prefix https://fcm.googleapis.com/fcm/send/dwve, expected a 2xx status`
 *     Both bounded attempts tripped (a fresh real subscription each time), proving the real push
 *     service itself rejects a VAPID header it cannot verify, the opposite-direction proof for
 *     T-110-31. The RESTORE leg re-ran clean (`--break needs-input-delivers RESTORE leg: PASS`,
 *     real push service observed HTTP status 201, tier two also observed the notification) after
 *     the captured bytes were restored, and `git diff --quiet` on `push-send.ts` confirmed a
 *     byte-identical restore.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { realpathSync } from "node:fs";
import { execFile, execFileSync, spawn } from "node:child_process";
import { createServer } from "node:http";
import { promisify } from "node:util";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import {
  createDecipheriv as gcmDecipheriv,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  randomUUID,
  verify as verifySignature,
} from "node:crypto";

const execFileP = promisify(execFile);

// ---------------------------------------------------------------------------
// Constants, sandbox/boot helper set. Ported from panel-109.mjs, renamed for
// this phase.
// ---------------------------------------------------------------------------

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST_ENTRY = join(REPO_ROOT, "dist", "server", "bootstrap", "index.js");
const BUILD_SCRIPT = "build";

const SANDBOX_PORT = 47883;
const CDP_PORT = 9381;
/** Declared now, first used by a later plan's fan-out/pruning checks. */
const STUB_PUSH_PORT = 47884;
const SANDBOX_PREFIX = "dispatch-panel-110-";

const POLL_INTERVAL_MS = 100;
const READY_TIMEOUT_MS = 30_000;
const KILL_TIMEOUT_MS = 5_000;

const CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

const FAKE_LINEAR_API_KEY = "panel-110-harness-fake-key-never-real";

/** Bound on `bootServerAt`'s accumulated log string, oldest text dropped first. */
const MAX_LOG_BYTES = 1024 * 1024;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Fail-closed: throw (never degrade) if anything answers on the user's real dispatch port. */
async function assertNoLiveService() {
  try {
    const res = await fetch("http://127.0.0.1:4700/api/board");
    await res.body?.cancel().catch(() => {});
    throw new Error(
      "PANEL-110-LIVE: a live dispatch service answered on http://127.0.0.1:4700/api/board, " +
        "refusing to start real processes or boot a sandbox server while the user's real service " +
        "is up. Stop the launchd service first, then rerun.",
    );
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("PANEL-110-LIVE"))
      throw err;
  }
}

function assertSandboxSafe(home) {
  if (SANDBOX_PORT === 4700) {
    throw new Error(
      "SANDBOX_PORT must never equal 4700, that is the user's live dispatch instance.",
    );
  }
  if (home === homedir()) {
    throw new Error(
      "sandbox home must never equal the real $HOME, refusing to proceed.",
    );
  }
  if (!home.startsWith(tmpdir())) {
    throw new Error(
      `sandbox home ${home} must live under ${tmpdir()}, refusing to proceed.`,
    );
  }
  if (!basename(home).startsWith(SANDBOX_PREFIX)) {
    throw new Error(
      `sandbox home ${home} must have a basename starting with "${SANDBOX_PREFIX}", refusing to proceed.`,
    );
  }
}

function makeSandboxHome(label) {
  const home = join(tmpdir(), `${SANDBOX_PREFIX}${label}-${process.pid}`);
  assertSandboxSafe(home);
  const dispatchDir = join(home, ".dispatch");
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
      // server not listening yet, keep polling
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(
    `server on :${port} did not answer 200 on /api/board within ${READY_TIMEOUT_MS}ms`,
  );
}

/** Teardown helper: SIGTERM, escalate to SIGKILL after a timeout. Always awaited in a `finally`.
 * Takes a raw `ChildProcess` (callers holding a `bootServerAt` result pass its `.child`). */
function stopServer(child) {
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

/** Best-effort sandbox home cleanup, called from a `finally` so a failing check never leaks a
 * temp directory. */
function cleanupSandboxHome(home) {
  if (home == null) return;
  rmSync(home, { recursive: true, force: true });
}

let headBuild = null;

/** Unconditional full `build` (web + server). Never mtime-gated. */
function assertBuilt() {
  if (headBuild !== null) return headBuild;
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
      `refusing to run, \`npm run ${BUILD_SCRIPT}\` failed, so dist/ does not reflect src/:\n${detail || err.message}`,
    );
  }
  if (!existsSync(DIST_ENTRY)) {
    throw new Error(
      `Missing ${DIST_ENTRY} after a successful \`npm run ${BUILD_SCRIPT}\`.`,
    );
  }
  headBuild = { durationMs: Date.now() - startedAt };
  console.log(
    `preflight: built src/ -> dist/ via \`npm run ${BUILD_SCRIPT}\` in ${headBuild.durationMs}ms`,
  );
  return headBuild;
}

/**
 * Resets `assertBuilt`'s memo so the next call forces a genuine rebuild.
 *
 * @remarks
 * This plan's break mutates a TypeScript source file and rebuilds; without this, `assertBuilt`'s
 * memo would skip that rebuild and the break would mutate dist without the source change ever
 * reaching it.
 */
function resetBuildCache() {
  headBuild = null;
}

/**
 * Break runs mutate real tracked files for minutes before their `finally` restore runs, and
 * Node's default SIGINT/SIGTERM handling terminates the process without unwinding those in-flight
 * async frames, silently leaving the sabotage bytes on disk. Every break runner registers its
 * captured original here BEFORE mutating and unregisters AFTER its `finally` restore, so a Ctrl-C
 * mid-break still restores the bytes.
 */
const pendingRestores = new Map();

function restoreOnSignal() {
  for (const [path, bytes] of pendingRestores) {
    try {
      writeFileSync(path, bytes);
    } catch {
      // best effort: an unwritable path here has no further recovery
    }
  }
  // The sources are restored but dist/ was built from the sabotaged bytes; the user's launchd
  // service runs dist/ and `git diff` reports clean, so remove it rather than leave it live.
  try {
    rmSync(join(REPO_ROOT, "dist"), { recursive: true, force: true });
    console.error(
      "panel-110: removed dist/ (it may hold break-mutated output); run `npm run build`",
    );
  } catch {
    // best effort: a survivor dist/ still gets rebuilt by the next assertBuilt()
  }
  process.exit(1);
}

function registerRestore(path, bytes) {
  if (pendingRestores.size === 0) {
    process.on("SIGINT", restoreOnSignal);
    process.on("SIGTERM", restoreOnSignal);
  }
  pendingRestores.set(path, bytes);
}

function unregisterRestore(path) {
  pendingRestores.delete(path);
  if (pendingRestores.size === 0) {
    process.off("SIGINT", restoreOnSignal);
    process.off("SIGTERM", restoreOnSignal);
  }
}

/** `entry` is REALPATH'd before being handed to `node`, the macOS /var -> /private/var trap.
 * DEVIATION from panel-109.mjs (see file header): pipes stdout/stderr into one bounded
 * accumulated string instead of ignoring them, so later checks can read the sandbox server's own
 * logs. Returns `{ child, log }`; `log()` returns the accumulated text observed so far. */
function bootServerAt(home) {
  assertBuilt();
  const env = { ...process.env, HOME: home, NODE_ENV: "production" };
  const child = spawn("node", [realpathSync(DIST_ENTRY)], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let acc = "";
  const append = (chunk) => {
    acc += chunk.toString("utf8");
    if (acc.length > MAX_LOG_BYTES) {
      acc = acc.slice(acc.length - MAX_LOG_BYTES);
    }
  };
  child.stdout.on("data", append);
  child.stderr.on("data", append);
  return { child, log: () => acc };
}

function readFlag(argv, flag) {
  const idx = argv.indexOf(flag);
  if (idx < 0) return null;
  const value = argv[idx + 1];
  if (value == null || value.startsWith("-")) {
    console.error(`${flag} requires a value`);
    process.exit(1);
  }
  return value;
}

async function isPortListening(port) {
  try {
    await execFileP("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Boot once against the still-empty sandbox home so the store creates the real sqlite schema (the
 * panel-93..109.mjs seeding idiom, never a hand-duplicated schema), kill that boot, then insert
 * every fixture row directly via `node:sqlite` in the same pass. Ported from panel-99.mjs's
 * `seedFixtureCards`, adjusted for this file's `SANDBOX_PORT` and `bootServerAt`'s `{ child, log
 * }` return shape.
 */
async function seedFixtureCards(home, cards) {
  const dbPath = join(home, ".dispatch", "board.db");
  const ATTEMPTS = 3;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const warmup = bootServerAt(home);
    try {
      await waitForReady(SANDBOX_PORT);
    } finally {
      await stopServer(warmup.child);
    }
    const deadline = Date.now() + 5_000;
    while ((await isPortListening(SANDBOX_PORT)) && Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS);
    }
    const db = new DatabaseSync(dbPath);
    try {
      const hasCardsTable =
        db
          .prepare(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'cards'",
          )
          .get() != null;
      if (!hasCardsTable) {
        console.log(
          `seedFixtureCards: schema not yet created after warmup attempt ${attempt}/${ATTEMPTS}, retrying`,
        );
        continue;
      }
      const insert = db.prepare(
        `INSERT INTO cards (id, data) VALUES (?, ?)
         ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
      );
      for (const card of cards) insert.run(card.id, JSON.stringify(card));
      return;
    } finally {
      db.close();
    }
  }
  throw new Error(
    `seedFixtureCards: sqlite schema never appeared after ${ATTEMPTS} warmup-boot attempts`,
  );
}

// ---------------------------------------------------------------------------
// CDP harness, ported verbatim in substance from panel-109.mjs (itself from
// panel-100.mjs). Not yet driven by this plan's own check, but every later
// plan in this phase drives headless Chrome through these same helpers, so
// they are kept parameterised rather than probe specific.
// ---------------------------------------------------------------------------

function findChrome() {
  const found = CHROME_CANDIDATES.find((p) => existsSync(p));
  if (!found) {
    throw new Error(
      `No Chrome binary found at any known path: ${CHROME_CANDIDATES.join(", ")}`,
    );
  }
  return found;
}

/** Minimal raw-CDP-over-WebSocket client (Node global WebSocket/fetch, zero new npm dependency). */
class CDP {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.eventListeners = new Map();
    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id != null && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      } else if (msg.method) {
        const listeners = this.eventListeners.get(msg.method);
        if (listeners) {
          for (const fn of [...listeners]) fn(msg.params, msg.sessionId);
        }
      }
    });
  }

  /** Registers a listener for a CDP event (e.g. `ServiceWorker.workerRegistrationUpdated`), never
   * for a command response (those resolve `send()`'s own promise). Returns an unsubscribe
   * function; this file's only two event consumers (ServiceWorker registration resolution) both
   * unsubscribe once they have what they need rather than leaking a listener for the rest of the
   * run. */
  on(method, fn) {
    if (!this.eventListeners.has(method)) {
      this.eventListeners.set(method, new Set());
    }
    this.eventListeners.get(method).add(fn);
    return () => this.eventListeners.get(method)?.delete(fn);
  }

  /**
   * `timeoutMs` is a defensive bound, not a normal-path concern: every CDP round trip this file
   * issues completes in well under a second. Its purpose is to turn a genuinely lost response into
   * a diagnosable rejection instead of hanging the whole process forever, since `this.pending`'s
   * resolve/reject pair otherwise has no other way to ever settle.
   */
  send(method, params = {}, sessionId, timeoutMs = 20_000) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const payload = { id, method, params };
      if (sessionId) payload.sessionId = sessionId;
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(
            new Error(
              `CDP.send: no response to ${method} (id ${id}) within ${timeoutMs}ms, the renderer likely stalled`,
            ),
          );
        }
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
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

async function waitForCdpUp() {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
      await res.body?.cancel();
      if (res.status === 200) return;
    } catch {
      // Chrome debugging port not up yet, keep polling
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`Chrome debugging port :${CDP_PORT} did not come up`);
}

async function evalValue(cdp, sessionId, expression) {
  const { result, exceptionDetails } = await cdp.send(
    "Runtime.evaluate",
    { expression, returnByValue: true, awaitPromise: false },
    sessionId,
  );
  if (exceptionDetails) {
    const thrown =
      exceptionDetails.exception?.description ??
      exceptionDetails.exception?.value ??
      exceptionDetails.text;
    throw new Error(
      `Runtime.evaluate failed: ${thrown}\n--- expression ---\n${expression}`,
    );
  }
  return result.value;
}

/** Identical to {@link evalValue} but for an expression that itself evaluates to a Promise. */
async function evalAsyncValue(cdp, sessionId, expression) {
  const { result, exceptionDetails } = await cdp.send(
    "Runtime.evaluate",
    { expression, returnByValue: true, awaitPromise: true },
    sessionId,
    35_000,
  );
  if (exceptionDetails) {
    const thrown =
      exceptionDetails.exception?.description ??
      exceptionDetails.exception?.value ??
      exceptionDetails.text;
    throw new Error(
      `Runtime.evaluate (async) failed: ${thrown}\n--- expression ---\n${expression}`,
    );
  }
  return result.value;
}

/** Same path `launchChrome` passes to `--user-data-dir` and the same path its caller must
 * `rmSync` in teardown, kept as one function so the two can never drift apart. */
function chromeUserDataDir() {
  return join(tmpdir(), `${SANDBOX_PREFIX}chrome-${process.pid}`);
}

/** Always a dedicated `--user-data-dir` under `tmpdir()`, never the developer's default Chrome
 * profile: granting a CDP permission into a real profile would be a durable side effect on their
 * machine. */
function launchChrome() {
  return spawn(
    findChrome(),
    [
      "--headless=new",
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${chromeUserDataDir()}`,
      "--no-first-run",
    ],
    { stdio: ["ignore", "ignore", "ignore"] },
  );
}

async function openPage(cdp, { url }) {
  const { targetId } = await cdp.send("Target.createTarget", { url });
  const { sessionId } = await cdp.send("Target.attachToTarget", {
    targetId,
    flatten: true,
  });
  await cdp.send("Page.enable", {}, sessionId);
  await cdp.send("Runtime.enable", {}, sessionId);
  await cdp.send(
    "Emulation.setDeviceMetricsOverride",
    { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false },
    sessionId,
  );
  return { targetId, sessionId };
}

/** Stands in for the prompt UI headless Chrome never renders: a dispatched click can never answer
 * a prompt that is not drawn. Tries the current `Browser.setPermission` method first and falls
 * back to the deprecated but functional `Browser.grantPermissions` when the target Chrome build
 * lacks it, logging which path fired. */
async function grantNotifications(cdp, origin) {
  try {
    await cdp.send("Browser.setPermission", {
      origin,
      permission: { name: "notifications" },
      setting: "granted",
    });
    console.log(`grantNotifications: used Browser.setPermission for ${origin}`);
  } catch (err) {
    console.log(
      `grantNotifications: Browser.setPermission failed (${err.message}), falling back to Browser.grantPermissions`,
    );
    await cdp.send("Browser.grantPermissions", {
      origin,
      permissions: ["notifications"],
    });
    console.log(
      `grantNotifications: used Browser.grantPermissions for ${origin}`,
    );
  }
}

/** Polls `expression` via {@link evalValue} until it is truthy, swallowing evaluate errors so a
 * transient stale execution context (e.g. immediately after `Page.navigate`) reads as "not ready
 * yet" instead of aborting the poll. Returns `null` on timeout rather than throwing, so callers
 * can attach their own diagnostic message. */
async function pollUntilTruthy(cdp, sessionId, expression, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const value = await evalValue(cdp, sessionId, expression);
      if (value) return value;
    } catch {
      // transient (e.g. navigation in flight), keep polling
    }
    await sleep(POLL_INTERVAL_MS);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Service worker push-delivery and notification-reading helpers (Plan 07's
// own new capability). `ServiceWorker.deliverPushMessage` was settled
// empirically as the delivery mechanism: it hands the real shipped sw.js a
// real plaintext payload with no fallback to a synthetic PushEvent needed,
// verified directly against a real booted sandbox and real headless Chrome
// (see the plan summary for the observed transcript).
// ---------------------------------------------------------------------------

/** Registers `/sw.js` from page scope the same way `src/web/lib/push.ts` does, then awaits
 * `navigator.serviceWorker.ready`, returning the registration's scope. Throws a descriptive error
 * if registration never settles inside `READY_TIMEOUT_MS` (surfaced by `evalAsyncValue`'s own
 * timeout, not a bespoke one, so a stalled registration reads as a diagnosable CDP error rather
 * than a silent `undefined`). */
async function ensureServiceWorkerReady(cdp, sessionId) {
  const scope = await evalAsyncValue(
    cdp,
    sessionId,
    `(async () => {
      await navigator.serviceWorker.register("/sw.js");
      const registration = await navigator.serviceWorker.ready;
      return registration.scope;
    })()`,
  );
  if (typeof scope !== "string" || scope === "") {
    throw new Error(
      "ensureServiceWorkerReady: navigator.serviceWorker.ready never settled with a scope",
    );
  }
  return scope;
}

/** Enables the CDP `ServiceWorker` domain on `sessionId` (the attached page session; the domain
 * reports every registration reachable from that page's browsing context, not just its own) and
 * resolves the `registrationId` whose `scopeURL` starts with `origin`. Filtering by scope is load
 * bearing: a headless Chrome profile registers its own extension service workers too, and an
 * unfiltered "first non-deleted registration" match resolves one of THOSE instead (observed
 * directly while building this helper), silently delivering the push to the wrong worker. */
async function resolveServiceWorkerRegistrationId(
  cdp,
  sessionId,
  origin,
  timeoutMs = READY_TIMEOUT_MS,
) {
  await cdp.send("ServiceWorker.enable", {}, sessionId);
  return new Promise((resolve) => {
    let settled = false;
    const off = cdp.on("ServiceWorker.workerRegistrationUpdated", (params) => {
      const match = (params.registrations ?? []).find(
        (r) => !r.isDeleted && r.scopeURL?.startsWith(origin),
      );
      if (match && !settled) {
        settled = true;
        off();
        resolve(match.registrationId);
      }
    });
    setTimeout(() => {
      if (!settled) {
        settled = true;
        off();
        resolve(null);
      }
    }, timeoutMs);
  });
}

/** Hands the real service worker a real plaintext push payload via
 * `ServiceWorker.deliverPushMessage`, bypassing the push service and its encryption (RFC 8291
 * receive-side decryption is Plan 04's own already-proven surface; this plan drives the CLIENT
 * side). Resolves `registrationId` from `origin` on first use unless the caller already has one
 * (from a prior call), so a check delivering several payloads in a row only pays the resolution
 * cost once. Returns the resolved `registrationId`. */
async function deliverPushToServiceWorker(
  cdp,
  sessionId,
  { origin, data, registrationId },
) {
  const resolvedId =
    registrationId ??
    (await resolveServiceWorkerRegistrationId(cdp, sessionId, origin));
  if (resolvedId == null) {
    throw new Error(
      `deliverPushToServiceWorker: no service worker registration resolved for origin ${origin}`,
    );
  }
  await cdp.send(
    "ServiceWorker.deliverPushMessage",
    {
      origin,
      registrationId: resolvedId,
      data: typeof data === "string" ? data : JSON.stringify(data),
    },
    sessionId,
  );
  return resolvedId;
}

/** Reads back what the service worker actually displayed: awaits `navigator.serviceWorker.ready`
 * from page scope, calls `registration.getNotifications()`, and maps each live `Notification`
 * (not serializable across CDP on its own) to a plain `{ tag, title, body }` object. */
async function readServiceWorkerNotifications(cdp, sessionId) {
  const notifications = await evalAsyncValue(
    cdp,
    sessionId,
    `(async () => {
      const registration = await navigator.serviceWorker.ready;
      const list = await registration.getNotifications();
      return list.map((n) => ({ tag: n.tag, title: n.title, body: n.body }));
    })()`,
  );
  return Array.isArray(notifications) ? notifications : [];
}

/** Polls {@link readServiceWorkerNotifications} until `predicate` holds or `timeoutMs` elapses,
 * returning whichever list was last observed either way. `showNotification()` inside the push
 * handler's `event.waitUntil()` resolves asynchronously, so a caller reading immediately after
 * `deliverPushToServiceWorker` can observe the notification list before it updates; polling turns
 * that race into a bounded wait instead of a flaky read. */
async function pollServiceWorkerNotifications(
  cdp,
  sessionId,
  predicate,
  timeoutMs,
) {
  const deadline = Date.now() + timeoutMs;
  let last = await readServiceWorkerNotifications(cdp, sessionId);
  while (Date.now() < deadline) {
    if (predicate(last)) return last;
    await sleep(POLL_INTERVAL_MS);
    last = await readServiceWorkerNotifications(cdp, sessionId);
  }
  return last;
}

/** Finds and attaches to the CDP target of type `service_worker` whose URL is `${origin}/sw.js`,
 * polling `Target.getTargets` since the worker target may not exist yet immediately after
 * registration. Returns `{ targetId, sessionId }` with `Runtime.enable` already sent on the new
 * session, so a caller can `Runtime.evaluate` inside the worker's own global scope (needed to
 * dispatch a synthetic `notificationclick` from inside the worker rather than the page). */
async function attachToServiceWorkerTarget(
  cdp,
  origin,
  timeoutMs = READY_TIMEOUT_MS,
) {
  const deadline = Date.now() + timeoutMs;
  const swUrl = `${origin}/sw.js`;
  while (Date.now() < deadline) {
    const { targetInfos } = await cdp.send("Target.getTargets", {});
    const swTarget = targetInfos.find(
      (t) => t.type === "service_worker" && t.url === swUrl,
    );
    if (swTarget) {
      const { sessionId } = await cdp.send("Target.attachToTarget", {
        targetId: swTarget.targetId,
        flatten: true,
      });
      await cdp.send("Runtime.enable", {}, sessionId);
      return { targetId: swTarget.targetId, sessionId };
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(
    `attachToServiceWorkerTarget: no service_worker target for ${swUrl} within ${timeoutMs}ms`,
  );
}

// ---------------------------------------------------------------------------
// Push subscription table readers, ported verbatim in substance from
// panel-109.mjs. Not yet driven by this plan's own check (no push tables are
// read here), but a later plan's send/fan-out checks need one shared reader
// vocabulary for the `push_subscriptions` table.
// ---------------------------------------------------------------------------

/** Independent read of the sandbox `board.db`'s `push_subscriptions` table, never trusting a
 * caller's own claim that a subscribe or unsubscribe succeeded. */
function readPushDbRows(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return db.prepare("SELECT * FROM push_subscriptions").all();
  } finally {
    db.close();
  }
}

/** Polls the independent database read until `predicate` holds or `timeoutMs` elapses, returning
 * whichever rows were last observed either way. */
async function pollPushDbRows(dbPath, predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = readPushDbRows(dbPath);
  while (Date.now() < deadline) {
    last = readPushDbRows(dbPath);
    if (predicate(last)) return last;
    await sleep(POLL_INTERVAL_MS);
  }
  return last;
}

// ---------------------------------------------------------------------------
// Stub push service, subscriber keys, and the RFC 8291/8292 receive side
// (Plan 04's own new capability): the harness impersonates a push service on
// loopback and independently decrypts what the real send pipeline sent it,
// so a later check can assert on real payload contents.
// ---------------------------------------------------------------------------

/** A `node:http` server bound to 127.0.0.1 on `STUB_PUSH_PORT`, recording every request as `{
 * method, path, headers, body }` (body collected as a Buffer) and answering with a status derived
 * from the path prefix, so one stub can play several push-service roles: `/ok/` -> 201, `/gone/`
 * -> 410, `/missing/` -> 404, `/busy/` -> 429, anything else -> 400. Callers must `close()` it in a
 * `finally`. */
function startStubPushService() {
  let recorded = [];
  const server = createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const path = req.url ?? "/";
      recorded.push({
        method: req.method ?? "",
        path,
        headers: { ...req.headers },
        body: Buffer.concat(chunks),
      });
      const status = path.startsWith("/ok/")
        ? 201
        : path.startsWith("/gone/")
          ? 410
          : path.startsWith("/missing/")
            ? 404
            : path.startsWith("/busy/")
              ? 429
              : 400;
      res.writeHead(status);
      res.end();
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(STUB_PUSH_PORT, "127.0.0.1", () => {
      server.off("error", reject);
      resolve({
        requests: () => [...recorded],
        reset: () => {
          recorded = [];
        },
        close: () => new Promise((r) => server.close(() => r())),
        waitForRequests: async (n, timeoutMs, settleMs = 1000) => {
          const deadline = Date.now() + timeoutMs;
          while (recorded.length < n && Date.now() < deadline) {
            await sleep(POLL_INTERVAL_MS);
          }
          // Settle so an "exactly n" assertion can observe an n+1th duplicate request too.
          await sleep(settleMs);
          return [...recorded];
        },
      });
    });
  });
}

/** Generates a P-256 keypair and a 16-byte auth secret, standing in for a browser's
 * `pushManager.subscribe()` output. `p256dh` is the base64url-encoded 65-byte uncompressed EC
 * point, `auth` is base64url, `privateKey` is the raw `KeyObject` kept for {@link
 * decryptPushBody}'s ECDH step. */
function makeSubscriberKeys() {
  const { publicKey, privateKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  const jwk = publicKey.export({ format: "jwk" });
  const point = Buffer.concat([
    Buffer.from([0x04]),
    Buffer.from(jwk.x, "base64url"),
    Buffer.from(jwk.y, "base64url"),
  ]);
  return {
    p256dh: point.toString("base64url"),
    auth: randomBytes(16).toString("base64url"),
    privateKey,
  };
}

/** INSERTs one row directly into the sandbox `push_subscriptions` table via `node:sqlite`
 * `DatabaseSync`, mirroring the schema `board-db.ts` creates. Callable several times against the
 * same sandbox home before a single server boot; the schema must already exist (a prior
 * `seedNeedsInputCard`/`seedFixtureCards` warmup boot guarantees that). */
function seedSubscriptionRow(home, { endpoint, keys, origin }) {
  const dbPath = join(home, ".dispatch", "board.db");
  const db = new DatabaseSync(dbPath);
  try {
    db.prepare(
      `INSERT INTO push_subscriptions (endpoint, p256dh, auth, origin, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth,
         origin = excluded.origin, created_at = excluded.created_at`,
    ).run(endpoint, keys.p256dh, keys.auth, origin, new Date().toISOString());
  } finally {
    db.close();
  }
}

/** Parses the `aes128gcm` header (RFC 8188: salt(16), record size(4 BE), key id length(1), key
 * id), rebuilds the server's ephemeral public key from the 65-byte point, runs the RFC 8291
 * receive-side derivation (ECDH via {@link diffieHellman}, then three `hkdfSync` stages each
 * wrapped in `Buffer.from`), decrypts with `aes-128-gcm` using the trailing 16 bytes as the auth
 * tag, strips the trailing `0x02` delimiter and any zero padding, and returns the parsed JSON.
 * Throws a descriptive error naming which stage failed (header length, point length, tag
 * verification, delimiter), so a check violation says what broke. */
function decryptPushBody(body, subscriberKeys) {
  if (!Buffer.isBuffer(body) || body.length < 21) {
    throw new Error(
      `decryptPushBody: body (${body?.length ?? 0} bytes) too short to contain an aes128gcm ` +
        `header (stage: header length)`,
    );
  }
  const salt = body.subarray(0, 16);
  const idlen = body.readUInt8(20);
  const headerLen = 21 + idlen;
  if (body.length < headerLen + 16) {
    throw new Error(
      `decryptPushBody: body (${body.length} bytes) too short for a ${idlen}-byte keyid plus a ` +
        `16-byte auth tag (stage: header length)`,
    );
  }
  const keyid = body.subarray(21, headerLen);
  if (keyid.length !== 65) {
    throw new Error(
      `decryptPushBody: server ephemeral public key point is ${keyid.length} bytes, expected 65 ` +
        `(stage: point length)`,
    );
  }
  const ciphertextAndTag = body.subarray(headerLen);
  const tag = ciphertextAndTag.subarray(ciphertextAndTag.length - 16);
  const ciphertext = ciphertextAndTag.subarray(0, ciphertextAndTag.length - 16);

  const serverEphemeralPublicKey = createPublicKey({
    key: {
      kty: "EC",
      crv: "P-256",
      x: keyid.subarray(1, 33).toString("base64url"),
      y: keyid.subarray(33, 65).toString("base64url"),
    },
    format: "jwk",
  });
  const sharedSecret = diffieHellman({
    privateKey: subscriberKeys.privateKey,
    publicKey: serverEphemeralPublicKey,
  });

  const subscriberPoint = Buffer.from(subscriberKeys.p256dh, "base64url");
  const authSecret = Buffer.from(subscriberKeys.auth, "base64url");
  const keyInfo = Buffer.concat([
    Buffer.from("WebPush: info\0"),
    subscriberPoint,
    keyid,
  ]);
  const prk = Buffer.from(
    hkdfSync("sha256", sharedSecret, authSecret, keyInfo, 32),
  );
  const cek = Buffer.from(
    hkdfSync(
      "sha256",
      prk,
      salt,
      Buffer.from("Content-Encoding: aes128gcm\0"),
      16,
    ),
  );
  const nonce = Buffer.from(
    hkdfSync("sha256", prk, salt, Buffer.from("Content-Encoding: nonce\0"), 12),
  );

  let decrypted;
  try {
    const decipher = gcmDecipheriv("aes-128-gcm", cek, nonce);
    decipher.setAuthTag(tag);
    decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch (err) {
    throw new Error(
      `decryptPushBody: AES-128-GCM tag verification failed (stage: tag verification): ${err.message}`,
    );
  }

  let end = decrypted.length;
  while (end > 0 && decrypted[end - 1] === 0x00) end--;
  if (end === 0 || decrypted[end - 1] !== 0x02) {
    throw new Error(
      "decryptPushBody: padding delimiter 0x02 not found after decryption (stage: delimiter)",
    );
  }
  return JSON.parse(decrypted.subarray(0, end - 1).toString("utf8"));
}

/** Parses a `vapid t=<jwt>, k=<pubkey>` Authorization header value, checks the decoded JWT header
 * names ES256, the claims' `aud` equals `endpointOrigin`, `exp` is in the future and no more
 * than 24 hours out and `sub` is a mailto:/https: contact URI, the decoded signature is exactly 64 bytes, and verifies it against a public
 * key rebuilt from `k` with `dsaEncoding: "ieee-p1363"`. Returns a list of problem strings (empty
 * when valid) rather than throwing, so a check can attribute each failure by name. */
function verifyVapidAuthorization(headerValue, endpointOrigin) {
  const problems = [];
  const match = /^vapid\s+t=([^,]+),\s*k=(.+)$/i.exec(
    (headerValue ?? "").trim(),
  );
  if (!match) {
    problems.push(
      `verifyVapidAuthorization: header value does not match "vapid t=..., k=..." shape: ${JSON.stringify(headerValue)}`,
    );
    return problems;
  }
  const [, jwt, k] = match;
  const parts = jwt.split(".");
  if (parts.length !== 3) {
    problems.push(
      `verifyVapidAuthorization: JWT has ${parts.length} dot-separated parts, expected 3`,
    );
    return problems;
  }
  const [headerB64, claimsB64, sigB64] = parts;

  let header;
  try {
    header = JSON.parse(Buffer.from(headerB64, "base64url").toString("utf8"));
  } catch (err) {
    problems.push(
      `verifyVapidAuthorization: JWT header is not valid JSON: ${err.message}`,
    );
    return problems;
  }
  if (header.alg !== "ES256") {
    problems.push(
      `verifyVapidAuthorization: JWT header alg is ${JSON.stringify(header.alg)}, expected "ES256"`,
    );
  }

  let claims;
  try {
    claims = JSON.parse(Buffer.from(claimsB64, "base64url").toString("utf8"));
  } catch (err) {
    problems.push(
      `verifyVapidAuthorization: JWT claims are not valid JSON: ${err.message}`,
    );
    return problems;
  }
  if (claims.aud !== endpointOrigin) {
    problems.push(
      `verifyVapidAuthorization: claims.aud is ${JSON.stringify(claims.aud)}, expected ${JSON.stringify(endpointOrigin)}`,
    );
  }
  const nowSec = Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== "number" || claims.exp <= nowSec) {
    problems.push(
      `verifyVapidAuthorization: claims.exp (${claims.exp}) is not in the future (now ${nowSec})`,
    );
  } else if (claims.exp - nowSec > 24 * 3600) {
    problems.push(
      `verifyVapidAuthorization: claims.exp is more than 24 hours out (${claims.exp - nowSec}s)`,
    );
  }
  if (typeof claims.sub !== "string" || !/^(mailto:|https:)/.test(claims.sub)) {
    problems.push(
      `verifyVapidAuthorization: claims.sub is ${JSON.stringify(claims.sub)}, expected a ` +
        `mailto: or https: contact URI (RFC 8292 section 2.1; Apple's push service rejects a ` +
        `token without it)`,
    );
  }

  const signature = Buffer.from(sigB64, "base64url");
  if (signature.length !== 64) {
    problems.push(
      `verifyVapidAuthorization: signature is ${signature.length} bytes, expected 64`,
    );
    return problems;
  }

  let publicKey;
  try {
    const point = Buffer.from(k, "base64url");
    if (point.length !== 65) {
      problems.push(
        `verifyVapidAuthorization: k= public key point is ${point.length} bytes, expected 65`,
      );
      return problems;
    }
    publicKey = createPublicKey({
      key: {
        kty: "EC",
        crv: "P-256",
        x: point.subarray(1, 33).toString("base64url"),
        y: point.subarray(33, 65).toString("base64url"),
      },
      format: "jwk",
    });
  } catch (err) {
    problems.push(
      `verifyVapidAuthorization: could not rebuild public key from k=: ${err.message}`,
    );
    return problems;
  }

  let valid = false;
  try {
    valid = verifySignature(
      "sha256",
      Buffer.from(`${headerB64}.${claimsB64}`),
      { key: publicKey, dsaEncoding: "ieee-p1363" },
      signature,
    );
  } catch (err) {
    problems.push(
      `verifyVapidAuthorization: signature verification threw: ${err.message}`,
    );
    return problems;
  }
  if (!valid) {
    problems.push(
      "verifyVapidAuthorization: ES256 signature did not verify against k=",
    );
  }

  return problems;
}

// ---------------------------------------------------------------------------
// Real-tmux marker driver (Plan 01's own new capability): a detached tmux
// pane, a literal DISPATCH_STATUS line typed into it, and an independent
// board.db read that never trusts the watcher's own claim of what happened.
// ---------------------------------------------------------------------------

/** `tmux new-session -d -s <name> -x 200 -y 50 bash`, argv form (never a shell string). The `-x
 * 200 -y 50` geometry matches `src/server/adapters/tmux.ts#newSession`'s own load-bearing
 * geometry for sane capture-pane output. */
async function startTmuxPane(name) {
  await execFileP("tmux", [
    "new-session",
    "-d",
    "-s",
    name,
    "-x",
    "200",
    "-y",
    "50",
    "bash",
  ]);
}

/** `tmux kill-session -t <name>`, best effort, always called from a `finally`. */
async function killTmuxPane(name) {
  try {
    await execFileP("tmux", ["kill-session", "-t", name]);
  } catch {
    // best effort: an already-dead session has nothing left to kill
  }
}

/** One fixture card shaped for `scanSession`'s preconditions (`src/server/adapters/markers/
 * watcher.ts`): `column: "in_progress"` (not `todo`, so the scan does not bail early), no
 * `source` set (matches panel-99.mjs's own fixture cards, defaulting to `"linear"` on read, a
 * non-`"group"` value since `"group"` is excluded from active-session mirroring elsewhere in the
 * store), `activeSessionId` and a matching `sessions` entry naming `tmuxSession`, plus the flat
 * `tmuxSession` mirror the pre-Phase-91 fallback paths still read. `statusChannel: "auto"` and no
 * `hookRoutedAt` stamp (both true by construction here, since this card is inserted directly, not
 * routed through a real hook POST) keep the pane-scan channel live. */
async function seedNeedsInputCard(
  home,
  { cardId, identifier, sessionId, tmuxSession },
) {
  const now = new Date().toISOString();
  const card = {
    id: cardId,
    issueId: `${cardId}-issue`,
    identifier,
    title: `panel-110 ${identifier} fixture card`,
    description: null,
    priority: 3,
    column: "in_progress",
    updatedAt: now,
    activeSessionId: sessionId,
    tmuxSession,
    sessions: [
      {
        id: sessionId,
        createdAt: now,
        updatedAt: now,
        tmuxSession,
      },
    ],
  };
  await seedFixtureCards(home, [card]);
}

/** Sends one literal marker line into the pane via `tmux send-keys`, argv form (never a shell
 * string built through node's own shell): the bullet glyph, a space, `DISPATCH_STATUS: `, `kind`,
 * a space, a plain ASCII hyphen, a space, and `reason`, followed by a real Enter keypress. The
 * pane's own `bash` interprets the typed `printf` command and its OUTPUT is what lands on the
 * capturable screen as the marker line; the typed command line itself never starts with the
 * bullet glyph, so it cannot itself match `MARKER_RE`.
 * @remarks `parse.ts#parseLastMarker` greedily joins every non-blank physical line after a marker
 * line into its reason until a boundary (blank line, a fresh bullet block, or the footer/input-box
 * border), a boundary a real claude TUI always supplies quickly, but a bare `bash` pane's next
 * shell prompt does not. The single `printf` call therefore also emits a border-chrome line
 * (`CHROME_BORDER_RE`) immediately after the marker, so the reason capture stops at exactly this
 * marker's own text instead of swallowing the next shell prompt as a false continuation. */
async function driveMarker(tmuxName, kind, reason) {
  const line = `⏺ DISPATCH_STATUS: ${kind} - ${reason}`;
  const border = "─".repeat(10);
  const escapeSingleQuoted = (s) => s.replace(/'/g, `'\\''`);
  const printfCmd = `printf '%s\\n%s\\n' '${escapeSingleQuoted(line)}' '${border}'`;
  await execFileP("tmux", ["send-keys", "-t", tmuxName, printfCmd, "Enter"]);
}

/** Opens the sandbox `board.db` with `node:sqlite` `DatabaseSync` on each poll (WAL mode, so a
 * read-only open never blocks on the server's own write connection), hands `predicate` the
 * parsed `cards` rows (JSON-parsed `data`) and the raw `events` rows, and returns the first
 * truthy predicate result. Throws on timeout with whatever rows were last observed, so a failing
 * caller has real evidence rather than a bare timeout message. */
async function pollBoardDb(home, predicate, timeoutMs) {
  const dbPath = join(home, ".dispatch", "board.db");
  const deadline = Date.now() + timeoutMs;
  let lastCards = [];
  let lastEvents = [];
  while (Date.now() < deadline) {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      lastCards = db
        .prepare("SELECT * FROM cards")
        .all()
        .map((row) => JSON.parse(row.data));
      lastEvents = db.prepare("SELECT * FROM events").all();
    } finally {
      db.close();
    }
    const result = predicate(lastCards, lastEvents);
    if (result) return result;
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(
    `pollBoardDb: predicate never became truthy within ${timeoutMs}ms. Last observed cards: ` +
      `${JSON.stringify(lastCards)}\nLast observed events: ${JSON.stringify(lastEvents)}`,
  );
}

const NEEDS_INPUT_TRIGGER_TICK_SLACK_MS = 15_000;

/** Boots a fresh sandbox home, starts a real detached tmux pane, seeds one fixture card shaped
 * for the watcher's preconditions, boots the real server, drives a real `NEEDS_INPUT` marker line
 * into the pane, then polls the sandbox `board.db` (never the app's own SSE/API claim) for BOTH
 * the card's persisted column and reason AND the corresponding `events` row. Pushes one named
 * violation per missed assertion; never a bare throw. Tears down the tmux pane, the server and
 * the sandbox home in a `finally`. */
async function checkNeedsInputTriggerFires(violations) {
  assertBuilt();
  const home = makeSandboxHome("needs-input-trigger-fires");
  const cardId = "panel-110-needs-input-trigger-fires";
  const identifier = "PANEL-110-01";
  const sessionId = randomUUID();
  const tmuxName = `${SANDBOX_PREFIX}pane-${process.pid}`;
  const reason = `panel-110-reason-${process.pid}-${Date.now()}`;
  let boot;
  try {
    await startTmuxPane(tmuxName);
    await seedNeedsInputCard(home, {
      cardId,
      identifier,
      sessionId,
      tmuxSession: tmuxName,
    });
    boot = bootServerAt(home);
    await waitForReady(SANDBOX_PORT);

    await driveMarker(tmuxName, "NEEDS_INPUT", reason);

    let observed;
    try {
      observed = await pollBoardDb(
        home,
        (cards, events) => {
          const card = cards.find((c) => c.id === cardId);
          const cardOk =
            card != null &&
            card.column === "needs_input" &&
            card.statusReason === reason;
          const event = events.find(
            (e) => e.type === "status_needs_input" && e.card_id === cardId,
          );
          if (cardOk && event) return { card, event };
          return null;
        },
        NEEDS_INPUT_TRIGGER_TICK_SLACK_MS,
      );
    } catch {
      observed = null;
    }

    if (observed == null) {
      const db = new DatabaseSync(join(home, ".dispatch", "board.db"), {
        readOnly: true,
      });
      let lastCard;
      let hadEvent;
      try {
        const row = db
          .prepare("SELECT data FROM cards WHERE id = ?")
          .get(cardId);
        lastCard = row ? JSON.parse(row.data) : null;
        hadEvent =
          db
            .prepare(
              "SELECT 1 FROM events WHERE type = 'status_needs_input' AND card_id = ?",
            )
            .get(cardId) != null;
      } finally {
        db.close();
      }
      if (
        lastCard == null ||
        lastCard.column !== "needs_input" ||
        lastCard.statusReason !== reason
      ) {
        violations.push(
          `needs-input-trigger-fires: card did not reach column "needs_input" with statusReason ` +
            `${JSON.stringify(reason)} within ${NEEDS_INPUT_TRIGGER_TICK_SLACK_MS}ms, observed ` +
            `column ${JSON.stringify(lastCard?.column ?? null)}`,
        );
      }
      if (!hadEvent) {
        violations.push(
          `needs-input-trigger-fires: no events row with type "status_needs_input" and card_id ` +
            `${JSON.stringify(cardId)} observed within ${NEEDS_INPUT_TRIGGER_TICK_SLACK_MS}ms`,
        );
      }
    }
  } finally {
    await killTmuxPane(tmuxName);
    await stopServer(boot?.child);
    cleanupSandboxHome(home);
  }
}

const PARSE_TS_PATH = join(REPO_ROOT, "src/server/adapters/markers/parse.ts");
const MARKER_RE_TARGET = "NEEDS_INPUT|DONE";
const MARKER_RE_REPLACEMENT = "NEEDS_INPUT_PANEL110_BREAK_NEVER_ON_PANE|DONE";

/** `--break needs-input-trigger-fires`: mutates `parse.ts`'s `MARKER_RE` so the `NEEDS_INPUT`
 * alternative can never match a real pane line (`driveMarker` always sends the literal text
 * `NEEDS_INPUT`), rebuilds via `resetBuildCache()`, and requires the SAME check function to
 * report both violations (trip leg). Restores the captured bytes unconditionally in a `finally`,
 * rebuilds, and requires a clean pass (restore leg). */
async function runBreakNeedsInputTriggerFires() {
  assertBuilt();
  const original = readFileSync(PARSE_TS_PATH, "utf8");
  const occurrences = original.split(MARKER_RE_TARGET).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `panel110: refusing to run --break needs-input-trigger-fires, expected ` +
        `${JSON.stringify(MARKER_RE_TARGET)} to occur exactly once in ${PARSE_TS_PATH}, measured ` +
        `${occurrences}. A miscounted anchor would mutate the wrong spot and report a false ` +
        `"the check cannot fail".`,
    );
  }

  let tripFired = false;
  registerRestore(PARSE_TS_PATH, original);
  try {
    writeFileSync(
      PARSE_TS_PATH,
      original.replace(MARKER_RE_TARGET, MARKER_RE_REPLACEMENT),
    );
    resetBuildCache();

    const tripViolations = [];
    await checkNeedsInputTriggerFires(tripViolations);
    console.log(
      `\n--break needs-input-trigger-fires TRIP leg output:\n${tripViolations.join("\n") || "(no violations)"}`,
    );
    tripFired =
      tripViolations.some((v) => v.includes('column "needs_input"')) &&
      tripViolations.some((v) => v.includes("status_needs_input"));
  } finally {
    writeFileSync(PARSE_TS_PATH, original);
    resetBuildCache();
    unregisterRestore(PARSE_TS_PATH);
  }

  const restoreViolations = [];
  await checkNeedsInputTriggerFires(restoreViolations);
  const restoreClean = restoreViolations.length === 0;
  console.log(
    `--break needs-input-trigger-fires RESTORE leg: ${restoreClean ? "PASS" : `FAIL:\n${restoreViolations.join("\n")}`}`,
  );

  return { tripFired, restoreClean };
}

const PUSH_ENVELOPE_TICK_SLACK_MS = 15_000;
const PUSH_LOG_TICK_SLACK_MS = 5_000;

/** Makes a sandbox home, generates subscriber keys, starts the stub push service, seeds one card
 * with a real tmux session and one subscription row pointed at the stub's `/ok/` path (`origin`
 * set to the sandbox loopback host and port), boots the real server, drives a real `NEEDS_INPUT`
 * marker with a unique reason, and asserts the resulting push request's headers, VAPID token and
 * decrypted envelope against an independent RFC 8291/8292 receive-side implementation. Tears down
 * the stub, the tmux pane, the server and the sandbox home in a `finally`. */
async function checkPushEnvelopeDecrypts(violations) {
  assertBuilt();
  const home = makeSandboxHome("push-envelope-decrypts");
  const cardId = "panel-110-push-envelope-decrypts";
  const identifier = "PANEL-110-04";
  const sessionId = randomUUID();
  const tmuxName = `${SANDBOX_PREFIX}push-pane-${process.pid}`;
  const reason = `panel-110-push-reason-${process.pid}-${Date.now()}`;
  const sandboxOrigin = `127.0.0.1:${SANDBOX_PORT}`;
  const endpoint = `http://127.0.0.1:${STUB_PUSH_PORT}/ok/panel-110-${process.pid}`;
  const keys = makeSubscriberKeys();

  let stub;
  let boot;
  try {
    stub = await startStubPushService();
    await startTmuxPane(tmuxName);
    await seedNeedsInputCard(home, {
      cardId,
      identifier,
      sessionId,
      tmuxSession: tmuxName,
    });
    seedSubscriptionRow(home, { endpoint, keys, origin: sandboxOrigin });
    boot = bootServerAt(home);
    await waitForReady(SANDBOX_PORT);

    await driveMarker(tmuxName, "NEEDS_INPUT", reason);

    const requests = await stub.waitForRequests(1, PUSH_ENVELOPE_TICK_SLACK_MS);
    if (requests.length !== 1) {
      violations.push(
        `push-envelope-decrypts: expected exactly 1 stub push request within ` +
          `${PUSH_ENVELOPE_TICK_SLACK_MS}ms, observed ${requests.length}`,
      );
    }
    const req = requests[0];

    if (req == null) {
      violations.push(
        "push-envelope-decrypts: no stub push request observed, cannot check its headers or body",
      );
    } else {
      if (req.method !== "POST") {
        violations.push(
          `push-envelope-decrypts: request method was ${JSON.stringify(req.method)}, expected "POST"`,
        );
      }
      if (req.headers["content-encoding"] !== "aes128gcm") {
        violations.push(
          `push-envelope-decrypts: content-encoding header was ` +
            `${JSON.stringify(req.headers["content-encoding"])}, expected "aes128gcm"`,
        );
      }
      if (req.headers.ttl == null) {
        violations.push("push-envelope-decrypts: ttl header is missing");
      }

      const authProblems = verifyVapidAuthorization(
        req.headers.authorization,
        `http://127.0.0.1:${STUB_PUSH_PORT}`,
      );
      for (const problem of authProblems) {
        violations.push(`push-envelope-decrypts: ${problem}`);
      }

      try {
        const payload = decryptPushBody(req.body, keys);
        if (!("cardId" in payload)) {
          violations.push(
            "push-envelope-decrypts: decrypted payload is missing a cardId field",
          );
        } else if (payload.cardId !== cardId) {
          violations.push(
            `push-envelope-decrypts: decrypted cardId was ${JSON.stringify(payload.cardId)}, ` +
              `expected ${JSON.stringify(cardId)}`,
          );
        }
        if (
          typeof payload.body !== "string" ||
          !payload.body.includes(reason)
        ) {
          violations.push(
            `push-envelope-decrypts: decrypted body ${JSON.stringify(payload.body)} does not ` +
              `contain the reason text ${JSON.stringify(reason)}`,
          );
        }
        if (
          typeof payload.title !== "string" ||
          !payload.title.includes(identifier)
        ) {
          violations.push(
            `push-envelope-decrypts: decrypted title ${JSON.stringify(payload.title)} does not ` +
              `contain the seeded card identifier ${JSON.stringify(identifier)}`,
          );
        }
        let url = null;
        try {
          url = new URL(payload.url);
        } catch {
          // handled by the null check below
        }
        if (
          url == null ||
          url.origin !== `http://${sandboxOrigin}` ||
          url.searchParams.get("card") !== cardId
        ) {
          violations.push(
            `push-envelope-decrypts: decrypted url ${JSON.stringify(payload.url)} is not an ` +
              `absolute URL on origin ${JSON.stringify(`http://${sandboxOrigin}`)} carrying a ` +
              `"card" query param equal to ${JSON.stringify(cardId)}`,
          );
        }
      } catch (err) {
        violations.push(
          `push-envelope-decrypts: decryptPushBody failed: ${err.message}`,
        );
      }
    }

    const logDeadline = Date.now() + PUSH_LOG_TICK_SLACK_MS;
    let sawSendLog = false;
    while (Date.now() < logDeadline) {
      if (/\[push\] send 201/.test(boot.log())) {
        sawSendLog = true;
        break;
      }
      await sleep(POLL_INTERVAL_MS);
    }
    if (!sawSendLog) {
      violations.push(
        "push-envelope-decrypts: sandbox server log never contained a line matching " +
          '"[push] send 201"',
      );
    }

    const rows = readPushDbRows(join(home, ".dispatch", "board.db"));
    if (!rows.some((row) => row.endpoint === endpoint)) {
      violations.push(
        "push-envelope-decrypts: subscription row was pruned after a 201, expected it to still " +
          "exist in push_subscriptions",
      );
    }
  } finally {
    if (stub) await stub.close();
    await killTmuxPane(tmuxName);
    await stopServer(boot?.child);
    cleanupSandboxHome(home);
  }
}

const BOOTSTRAP_INDEX_TS_PATH = join(
  REPO_ROOT,
  "src/server/bootstrap/index.ts",
);

const PUSH_SEND_TS_PATH = join(
  REPO_ROOT,
  "src/server/services/domain/push-send.ts",
);
const PUSH_SEND_BREAK_TARGET = '\n    dsaEncoding: "ieee-p1363",';

const APP_TSX_PATH = join(REPO_ROOT, "src/web/App.tsx");

/** `--break push-envelope-decrypts`: removes the `dsaEncoding: "ieee-p1363"` option from
 * `signVapidJwt`'s `sign()` call, so the VAPID signature reverts to Node's DER default, rebuilds
 * via `resetBuildCache()`, and requires the SAME check function to report the resulting violation
 * (trip leg). Restores the captured bytes unconditionally in a `finally`, rebuilds, and requires a
 * clean pass (restore leg).
 * @remarks `signVapidJwt` itself already asserts `signature.length !== 64` and throws before ever
 * sending, so this break's observed failure mode is "no stub push request arrived" (the per-row
 * `try/catch` in `sendPushForCard` swallows the throw and logs `[push] send-failed`), not a
 * signature-verification mismatch on the wire. Both are valid proof the check is not a dead
 * instrument: either shape means the un-encoded signature never reaches a state this check would
 * silently accept. */
async function runBreakPushEnvelopeDecrypts() {
  assertBuilt();
  const original = readFileSync(PUSH_SEND_TS_PATH, "utf8");
  const occurrences = original.split(PUSH_SEND_BREAK_TARGET).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `panel110: refusing to run --break push-envelope-decrypts, expected ` +
        `${JSON.stringify(PUSH_SEND_BREAK_TARGET)} to occur exactly once in ${PUSH_SEND_TS_PATH}, ` +
        `measured ${occurrences}. A miscounted anchor would mutate the wrong spot and report a ` +
        `false "the check cannot fail".`,
    );
  }

  let tripFired = false;
  registerRestore(PUSH_SEND_TS_PATH, original);
  try {
    writeFileSync(
      PUSH_SEND_TS_PATH,
      original.replace(PUSH_SEND_BREAK_TARGET, ""),
    );
    resetBuildCache();

    const tripViolations = [];
    await checkPushEnvelopeDecrypts(tripViolations);
    console.log(
      `\n--break push-envelope-decrypts TRIP leg output:\n${tripViolations.join("\n") || "(no violations)"}`,
    );
    tripFired = tripViolations.some(
      (v) =>
        v.includes("signature is") ||
        v.includes("did not verify against k=") ||
        v.includes("no stub push request observed") ||
        v.includes("expected exactly 1 stub push request"),
    );
  } finally {
    writeFileSync(PUSH_SEND_TS_PATH, original);
    resetBuildCache();
    unregisterRestore(PUSH_SEND_TS_PATH);
  }

  const restoreViolations = [];
  await checkPushEnvelopeDecrypts(restoreViolations);
  const restoreClean = restoreViolations.length === 0;
  console.log(
    `--break push-envelope-decrypts RESTORE leg: ${restoreClean ? "PASS" : `FAIL:\n${restoreViolations.join("\n")}`}`,
  );

  return { tripFired, restoreClean };
}

// ---------------------------------------------------------------------------
// Plan 05's own new capability (PUSH-03, PUSH-06): the two absence-and-
// arithmetic checks. Neither drives headless Chrome; both reuse the real
// tmux/board.db/stub-push machinery every earlier plan in this phase built.
// ---------------------------------------------------------------------------

const AGENT_DONE_EVENT_TICK_SLACK_MS = 15_000;
const AGENT_DONE_SETTLE_MS = 3_000;

/** Makes a sandbox home, a stub push service and one seeded subscription row on the stub's
 * `/ok/` path, seeds one fixture card with a real tmux pane, boots the real server, drives a
 * real `DONE` marker with a unique reason, and polls the sandbox `board.db` for the positive
 * control (an `events` row with `type = "status_agent_done"` for the seeded card) before
 * asserting anything about push traffic: a DONE transition that never fired would make a
 * zero-request assertion pass vacuously, so a missing positive-control row is itself a named
 * violation. Only once the transition is proven to have happened does it wait a further settle
 * window and assert the stub saw zero requests and the sandbox server's own log carries no
 * `[push] send` line. Tears down the stub, the tmux pane, the server and the sandbox home in a
 * `finally`. */
async function checkAgentDoneNoPush(violations) {
  assertBuilt();
  const home = makeSandboxHome("agent-done-no-push");
  const cardId = "panel-110-agent-done-no-push";
  const identifier = "PANEL-110-05a";
  const sessionId = randomUUID();
  const tmuxName = `${SANDBOX_PREFIX}done-pane-${process.pid}`;
  const reason = `panel-110-done-reason-${process.pid}-${Date.now()}`;
  const sandboxOrigin = `127.0.0.1:${SANDBOX_PORT}`;
  const endpoint = `http://127.0.0.1:${STUB_PUSH_PORT}/ok/panel-110-done-${process.pid}`;
  const keys = makeSubscriberKeys();

  let stub;
  let boot;
  try {
    stub = await startStubPushService();
    await startTmuxPane(tmuxName);
    await seedNeedsInputCard(home, {
      cardId,
      identifier,
      sessionId,
      tmuxSession: tmuxName,
    });
    seedSubscriptionRow(home, { endpoint, keys, origin: sandboxOrigin });
    boot = bootServerAt(home);
    await waitForReady(SANDBOX_PORT);

    await driveMarker(tmuxName, "DONE", reason);

    let hadEvent = false;
    try {
      await pollBoardDb(
        home,
        (_cards, events) => {
          const found = events.find(
            (e) => e.type === "status_agent_done" && e.card_id === cardId,
          );
          if (found) hadEvent = true;
          return found ?? null;
        },
        AGENT_DONE_EVENT_TICK_SLACK_MS,
      );
    } catch {
      // handled by the hadEvent check below
    }

    if (!hadEvent) {
      violations.push(
        `agent-done-no-push: no events row with type "status_agent_done" and card_id ` +
          `${JSON.stringify(cardId)} observed within ${AGENT_DONE_EVENT_TICK_SLACK_MS}ms, the ` +
          "positive control that the DONE transition really happened did not fire, so the " +
          "zero-push assertion below would be vacuous",
      );
    } else {
      await sleep(AGENT_DONE_SETTLE_MS);

      const requests = stub.requests();
      if (requests.length !== 0) {
        violations.push(
          "agent-done-no-push: expected zero stub push requests after an agent-done transition, " +
            `observed ${requests.length}`,
        );
      }
      if (/\[push\] send/.test(boot.log())) {
        violations.push(
          'agent-done-no-push: sandbox server log contains a "[push] send" line after an ' +
            "agent-done transition, expected none",
        );
      }
    }
  } finally {
    if (stub) await stub.close();
    await killTmuxPane(tmuxName);
    await stopServer(boot?.child);
    cleanupSandboxHome(home);
  }
}

const AGENT_DONE_BREAK_TARGET = 'event.type !== "status_needs_input"';
const AGENT_DONE_BREAK_REPLACEMENT = 'event.type !== "status_agent_done"';

/** `--break agent-done-no-push`: flips `bootstrap/index.ts`'s activity listener filter from
 * `status_needs_input` to `status_agent_done`, so a DONE transition now sends push instead of a
 * needs-input one, rebuilds via `resetBuildCache()`, and requires the SAME check function to
 * report the resulting violation (trip leg). Restores the captured bytes unconditionally in a
 * `finally`, rebuilds, and requires a clean pass (restore leg). */
async function runBreakAgentDoneNoPush() {
  assertBuilt();
  const original = readFileSync(BOOTSTRAP_INDEX_TS_PATH, "utf8");
  const occurrences = original.split(AGENT_DONE_BREAK_TARGET).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `panel110: refusing to run --break agent-done-no-push, expected ` +
        `${JSON.stringify(AGENT_DONE_BREAK_TARGET)} to occur exactly once in ` +
        `${BOOTSTRAP_INDEX_TS_PATH}, measured ${occurrences}. A miscounted anchor would mutate ` +
        `the wrong spot and report a false "the check cannot fail".`,
    );
  }

  let tripFired = false;
  registerRestore(BOOTSTRAP_INDEX_TS_PATH, original);
  try {
    writeFileSync(
      BOOTSTRAP_INDEX_TS_PATH,
      original.replace(AGENT_DONE_BREAK_TARGET, AGENT_DONE_BREAK_REPLACEMENT),
    );
    resetBuildCache();

    const tripViolations = [];
    await checkAgentDoneNoPush(tripViolations);
    console.log(
      `\n--break agent-done-no-push TRIP leg output:\n${tripViolations.join("\n") || "(no violations)"}`,
    );
    tripFired = tripViolations.some((v) =>
      v.includes("expected zero stub push requests"),
    );
  } finally {
    writeFileSync(BOOTSTRAP_INDEX_TS_PATH, original);
    resetBuildCache();
    unregisterRestore(BOOTSTRAP_INDEX_TS_PATH);
  }

  const restoreViolations = [];
  await checkAgentDoneNoPush(restoreViolations);
  const restoreClean = restoreViolations.length === 0;
  console.log(
    `--break agent-done-no-push RESTORE leg: ${restoreClean ? "PASS" : `FAIL:\n${restoreViolations.join("\n")}`}`,
  );

  return { tripFired, restoreClean };
}

const MULTI_DEVICE_PRUNE_TICK_SLACK_MS = 20_000;
const MULTI_DEVICE_PRUNE_SETTLE_MS = 3_000;

/** Makes a sandbox home, a stub push service and FOUR seeded subscription rows (`/ok/alive` 201,
 * `/gone/dead410` 410, `/missing/dead404` 404, `/busy/throttled` 429), each with its own
 * subscriber keypair and alternating between two distinct `origin` values (demonstrating D-06: a
 * stored origin never filters who gets sent to), seeds one fixture card with a real tmux pane,
 * boots the real server, drives one real `NEEDS_INPUT` marker with a unique reason, and asserts
 * that the fan-out reached all four endpoints, each request decrypts only with its OWN
 * subscriber keys, the sandbox log carries one `[push] send <status>` line per endpoint, and
 * after a settle window `push_subscriptions` retains exactly the 201 and 429 rows. Tears down
 * the stub, the tmux pane, the server and the sandbox home in a `finally`. */
async function checkMultiDevicePrune(violations) {
  assertBuilt();
  const home = makeSandboxHome("multi-device-prune");
  const cardId = "panel-110-multi-device-prune";
  const identifier = "PANEL-110-05b";
  const sessionId = randomUUID();
  const tmuxName = `${SANDBOX_PREFIX}multi-pane-${process.pid}`;
  const reason = `panel-110-multi-reason-${process.pid}-${Date.now()}`;
  const originA = `127.0.0.1:${SANDBOX_PORT}`;
  const originB = `panel-110-second-origin-${process.pid}.example`;

  const rowSpecs = [
    { path: "/ok/alive", origin: originA, status: 201 },
    { path: "/gone/dead410", origin: originB, status: 410 },
    { path: "/missing/dead404", origin: originA, status: 404 },
    { path: "/busy/throttled", origin: originB, status: 429 },
  ];
  const rows = rowSpecs.map((spec) => ({
    ...spec,
    endpoint: `http://127.0.0.1:${STUB_PUSH_PORT}${spec.path}`,
    keys: makeSubscriberKeys(),
  }));

  let stub;
  let boot;
  try {
    stub = await startStubPushService();
    await startTmuxPane(tmuxName);
    await seedNeedsInputCard(home, {
      cardId,
      identifier,
      sessionId,
      tmuxSession: tmuxName,
    });
    for (const row of rows) {
      seedSubscriptionRow(home, {
        endpoint: row.endpoint,
        keys: row.keys,
        origin: row.origin,
      });
    }
    boot = bootServerAt(home);
    await waitForReady(SANDBOX_PORT);

    await driveMarker(tmuxName, "NEEDS_INPUT", reason);

    const requests = await stub.waitForRequests(
      4,
      MULTI_DEVICE_PRUNE_TICK_SLACK_MS,
    );
    if (requests.length !== 4) {
      violations.push(
        `multi-device-prune: expected exactly 4 stub push requests within ` +
          `${MULTI_DEVICE_PRUNE_TICK_SLACK_MS}ms, observed ${requests.length}`,
      );
    }

    const seenPaths = new Set(requests.map((r) => r.path));
    for (const row of rows) {
      if (!seenPaths.has(row.path)) {
        violations.push(
          `multi-device-prune: no stub request observed for endpoint path ` +
            `${JSON.stringify(row.path)}, fan-out did not reach every device`,
        );
      }
    }

    for (const row of rows) {
      const req = requests.find((r) => r.path === row.path);
      if (req == null) continue;
      try {
        const payload = decryptPushBody(req.body, row.keys);
        if (payload.cardId !== cardId) {
          violations.push(
            `multi-device-prune: request to ${row.path} decrypted cardId ` +
              `${JSON.stringify(payload.cardId)}, expected ${JSON.stringify(cardId)}`,
          );
        }
      } catch (err) {
        violations.push(
          `multi-device-prune: request to ${row.path} did not decrypt with its own subscriber ` +
            `keys (proves per-row encryption, not one envelope reused): ${err.message}`,
        );
      }
    }

    const logDeadline = Date.now() + PUSH_LOG_TICK_SLACK_MS;
    let missingLogLines = rows.map(
      (row) => `[push] send ${row.status} ${row.endpoint}`,
    );
    while (Date.now() < logDeadline && missingLogLines.length > 0) {
      const log = boot.log();
      missingLogLines = missingLogLines.filter((line) => !log.includes(line));
      if (missingLogLines.length > 0) await sleep(POLL_INTERVAL_MS);
    }
    for (const line of missingLogLines) {
      violations.push(
        `multi-device-prune: sandbox server log never contained a line ${JSON.stringify(line)}`,
      );
    }

    await sleep(MULTI_DEVICE_PRUNE_SETTLE_MS);
    const survivingRows = readPushDbRows(join(home, ".dispatch", "board.db"));
    const survivingEndpoints = new Set(survivingRows.map((r) => r.endpoint));
    for (const row of rows) {
      const shouldSurvive = row.status === 201 || row.status === 429;
      const survives = survivingEndpoints.has(row.endpoint);
      if (shouldSurvive && !survives) {
        violations.push(
          `multi-device-prune: endpoint ${row.path} (status ${row.status}) was pruned, expected ` +
            "it to survive (only 404/410 prune)",
        );
      }
      if (!shouldSurvive && survives) {
        violations.push(
          `multi-device-prune: endpoint ${row.path} (status ${row.status}) survived, expected ` +
            "it pruned",
        );
      }
    }
  } finally {
    if (stub) await stub.close();
    await killTmuxPane(tmuxName);
    await stopServer(boot?.child);
    cleanupSandboxHome(home);
  }
}

const MULTI_DEVICE_PRUNE_BREAK_TARGET = "res.status === 410";
const MULTI_DEVICE_PRUNE_BREAK_REPLACEMENT = "res.status === 999410";

/** `--break multi-device-prune`: changes `push-send.ts`'s prune condition so a 410 response no
 * longer prunes its row (replaces the `410` literal with an unreachable HTTP status number),
 * rebuilds via `resetBuildCache()`, and requires the SAME check function to report the resulting
 * violation (trip leg). Restores the captured bytes unconditionally in a `finally`, rebuilds, and
 * requires a clean pass (restore leg). */
async function runBreakMultiDevicePrune() {
  assertBuilt();
  const original = readFileSync(PUSH_SEND_TS_PATH, "utf8");
  const occurrences =
    original.split(MULTI_DEVICE_PRUNE_BREAK_TARGET).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `panel110: refusing to run --break multi-device-prune, expected ` +
        `${JSON.stringify(MULTI_DEVICE_PRUNE_BREAK_TARGET)} to occur exactly once in ` +
        `${PUSH_SEND_TS_PATH}, measured ${occurrences}. A miscounted anchor would mutate the ` +
        `wrong spot and report a false "the check cannot fail".`,
    );
  }

  let tripFired = false;
  registerRestore(PUSH_SEND_TS_PATH, original);
  try {
    writeFileSync(
      PUSH_SEND_TS_PATH,
      original.replace(
        MULTI_DEVICE_PRUNE_BREAK_TARGET,
        MULTI_DEVICE_PRUNE_BREAK_REPLACEMENT,
      ),
    );
    resetBuildCache();

    const tripViolations = [];
    await checkMultiDevicePrune(tripViolations);
    console.log(
      `\n--break multi-device-prune TRIP leg output:\n${tripViolations.join("\n") || "(no violations)"}`,
    );
    tripFired = tripViolations.some((v) =>
      v.includes("survived, expected it pruned"),
    );
  } finally {
    writeFileSync(PUSH_SEND_TS_PATH, original);
    resetBuildCache();
    unregisterRestore(PUSH_SEND_TS_PATH);
  }

  const restoreViolations = [];
  await checkMultiDevicePrune(restoreViolations);
  const restoreClean = restoreViolations.length === 0;
  console.log(
    `--break multi-device-prune RESTORE leg: ${restoreClean ? "PASS" : `FAIL:\n${restoreViolations.join("\n")}`}`,
  );

  return { tripFired, restoreClean };
}

// ---------------------------------------------------------------------------
// Per-origin deep link (Plan 06): two subscription rows stored under
// different origins must each receive a deep link built from their own
// origin, and a stale origin must never cost a row its place in the store
// (D-06/D-07).
// ---------------------------------------------------------------------------

const PER_ORIGIN_DEEP_LINK_TICK_SLACK_MS = 15_000;
const PER_ORIGIN_DEEP_LINK_SETTLE_MS = 3_000;

/** Seeds one loopback-origin row and one fake-tunnel-origin row (a device that subscribed under a
 * tunnel hostname that has since rotated), drives one real NEEDS_INPUT marker, and decrypts each
 * row's own push envelope with its own subscriber keys to assert its deep-link `url` carries that
 * row's own origin, the right scheme, and the seeded card id, that the two rows' urls differ, and
 * that neither row is pruned (an origin mismatch is never a reason to delete a row, D-07). */
async function checkPerOriginDeepLink(violations) {
  assertBuilt();
  const home = makeSandboxHome("per-origin-deep-link");
  const cardId = "panel-110-per-origin-deep-link";
  const identifier = "PANEL-110-06a";
  const sessionId = randomUUID();
  const tmuxName = `${SANDBOX_PREFIX}per-origin-pane-${process.pid}`;
  const reason = `panel-110-per-origin-reason-${process.pid}-${Date.now()}`;
  const loopbackOrigin = `127.0.0.1:${SANDBOX_PORT}`;
  const tunnelOrigin = `panel-110-tunnel-${process.pid}.trycloudflare.com`;

  const rows = [
    { path: "/ok/loopback", origin: loopbackOrigin, scheme: "http:" },
    { path: "/ok/tunnel", origin: tunnelOrigin, scheme: "https:" },
  ].map((row) => ({
    ...row,
    endpoint: `http://127.0.0.1:${STUB_PUSH_PORT}${row.path}`,
    keys: makeSubscriberKeys(),
  }));

  let stub;
  let boot;
  try {
    stub = await startStubPushService();
    await startTmuxPane(tmuxName);
    await seedNeedsInputCard(home, {
      cardId,
      identifier,
      sessionId,
      tmuxSession: tmuxName,
    });
    for (const row of rows) {
      seedSubscriptionRow(home, {
        endpoint: row.endpoint,
        keys: row.keys,
        origin: row.origin,
      });
    }
    boot = bootServerAt(home);
    await waitForReady(SANDBOX_PORT);

    await driveMarker(tmuxName, "NEEDS_INPUT", reason);

    const requests = await stub.waitForRequests(
      2,
      PER_ORIGIN_DEEP_LINK_TICK_SLACK_MS,
    );
    if (requests.length !== 2) {
      violations.push(
        `per-origin-deep-link: expected exactly 2 stub push requests within ` +
          `${PER_ORIGIN_DEEP_LINK_TICK_SLACK_MS}ms, observed ${requests.length}`,
      );
    }

    const payloads = {};
    for (const row of rows) {
      const req = requests.find((r) => r.path === row.path);
      if (req == null) {
        violations.push(
          `per-origin-deep-link: no stub request observed for endpoint path ` +
            `${JSON.stringify(row.path)}`,
        );
        continue;
      }
      try {
        payloads[row.path] = decryptPushBody(req.body, row.keys);
      } catch (err) {
        violations.push(
          `per-origin-deep-link: request to ${row.path} did not decrypt with its own ` +
            `subscriber keys: ${err.message}`,
        );
      }
    }

    for (const row of rows) {
      const payload = payloads[row.path];
      if (payload == null) continue;
      let url;
      try {
        url = new URL(payload.url);
      } catch {
        url = null;
      }
      if (url == null) {
        violations.push(
          `per-origin-deep-link: ${row.path} row's payload url ` +
            `${JSON.stringify(payload.url)} is not a valid absolute URL`,
        );
        continue;
      }
      if (url.protocol !== row.scheme) {
        violations.push(
          `per-origin-deep-link: ${row.path} row's payload url uses scheme ` +
            `${JSON.stringify(url.protocol)}, expected ${JSON.stringify(row.scheme)}`,
        );
      }
      if (url.host !== row.origin) {
        violations.push(
          `per-origin-deep-link: ${row.path} row's payload url host is ` +
            `${JSON.stringify(url.host)}, expected ${JSON.stringify(row.origin)}`,
        );
      }
      if (url.searchParams.get("card") !== cardId) {
        violations.push(
          `per-origin-deep-link: ${row.path} row's payload url card param is ` +
            `${JSON.stringify(url.searchParams.get("card"))}, expected ${JSON.stringify(cardId)}`,
        );
      }
    }

    const loopbackPayload = payloads["/ok/loopback"];
    const tunnelPayload = payloads["/ok/tunnel"];
    if (
      loopbackPayload != null &&
      tunnelPayload != null &&
      loopbackPayload.url === tunnelPayload.url
    ) {
      violations.push(
        `per-origin-deep-link: loopback and tunnel rows received the identical deep-link url ` +
          `${JSON.stringify(loopbackPayload.url)}, expected them to differ (a single shared ` +
          `origin for both rows is the failure this check exists to catch)`,
      );
    }

    await sleep(PER_ORIGIN_DEEP_LINK_SETTLE_MS);
    const survivingRows = readPushDbRows(join(home, ".dispatch", "board.db"));
    const survivingEndpoints = new Set(survivingRows.map((r) => r.endpoint));
    for (const row of rows) {
      if (!survivingEndpoints.has(row.endpoint)) {
        violations.push(
          `per-origin-deep-link: endpoint ${row.path} (origin ${row.origin}) was pruned, ` +
            `expected it to survive (an origin mismatch is never a reason to delete a row, D-07)`,
        );
      }
    }
  } finally {
    if (stub) await stub.close();
    await killTmuxPane(tmuxName);
    await stopServer(boot?.child);
    cleanupSandboxHome(home);
  }
}

const PER_ORIGIN_DEEP_LINK_BREAK_TARGET = "deepLinkUrl(sub.origin, card.id)";
const PER_ORIGIN_DEEP_LINK_BREAK_REPLACEMENT =
  'deepLinkUrl("panel-110-break-fixed-origin.example", card.id)';

/** `--break per-origin-deep-link`: makes `push-send.ts` build every row's deep-link url from one
 * fixed origin instead of the row's own (replaces the sole `deepLinkUrl(sub.origin, card.id)`
 * call site), rebuilds via `resetBuildCache()`, and requires the SAME check function to report
 * the resulting "expected them to differ" violation (trip leg). Restores the captured bytes
 * unconditionally in a `finally`, rebuilds, and requires a clean pass (restore leg). */
async function runBreakPerOriginDeepLink() {
  assertBuilt();
  const original = readFileSync(PUSH_SEND_TS_PATH, "utf8");
  const occurrences =
    original.split(PER_ORIGIN_DEEP_LINK_BREAK_TARGET).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `panel110: refusing to run --break per-origin-deep-link, expected ` +
        `${JSON.stringify(PER_ORIGIN_DEEP_LINK_BREAK_TARGET)} to occur exactly once in ` +
        `${PUSH_SEND_TS_PATH}, measured ${occurrences}. A miscounted anchor would mutate the ` +
        `wrong spot and report a false "the check cannot fail".`,
    );
  }

  let tripFired = false;
  registerRestore(PUSH_SEND_TS_PATH, original);
  try {
    writeFileSync(
      PUSH_SEND_TS_PATH,
      original.replace(
        PER_ORIGIN_DEEP_LINK_BREAK_TARGET,
        PER_ORIGIN_DEEP_LINK_BREAK_REPLACEMENT,
      ),
    );
    resetBuildCache();

    const tripViolations = [];
    await checkPerOriginDeepLink(tripViolations);
    console.log(
      `\n--break per-origin-deep-link TRIP leg output:\n${tripViolations.join("\n") || "(no violations)"}`,
    );
    tripFired = tripViolations.some((v) =>
      v.includes("expected them to differ"),
    );
  } finally {
    writeFileSync(PUSH_SEND_TS_PATH, original);
    resetBuildCache();
    unregisterRestore(PUSH_SEND_TS_PATH);
  }

  const restoreViolations = [];
  await checkPerOriginDeepLink(restoreViolations);
  const restoreClean = restoreViolations.length === 0;
  console.log(
    `--break per-origin-deep-link RESTORE leg: ${restoreClean ? "PASS" : `FAIL:\n${restoreViolations.join("\n")}`}`,
  );

  return { tripFired, restoreClean };
}

// ---------------------------------------------------------------------------
// CHECKS / BREAKS / PROBES registries. Every later plan in this phase
// appends here.
// ---------------------------------------------------------------------------

const DEEP_LINK_PARAM_RENDER_TIMEOUT_MS = 20_000;

function deepLinkFixtureCard(id, identifier) {
  return {
    id,
    issueId: `${id}-issue`,
    identifier,
    title: `panel-110 ${identifier} fixture card`,
    description: null,
    priority: 3,
    column: "todo",
    updatedAt: new Date().toISOString(),
  };
}

/** Seeds two fixture cards (so the target card is distinguishable from a default selection),
 * opens headless Chrome directly at the sandbox board URL carrying `?card=<second card's id>`,
 * and asserts the detail panel (`[aria-label="Ticket detail"]`, the same aside App.tsx docks
 * regardless of selection per the PANEL-03 never-remount invariant) ends up showing the target
 * card's identifier and NOT the other fixture card's identifier, that `window.location.search` no
 * longer contains `card` once the effect has run, and that `window.location.pathname` is
 * unchanged. Always tears down Chrome and its user-data directory in a `finally`. */
async function checkDeepLinkParamOpensCard(violations) {
  assertBuilt();
  const home = makeSandboxHome("deep-link-param-opens-card");
  const cardAId = "panel-110-deep-link-card-a";
  const cardAIdentifier = "PANEL-110-06b-A";
  const cardBId = "panel-110-deep-link-card-b";
  const cardBIdentifier = "PANEL-110-06b-B";

  let boot;
  let chrome;
  let cdp;
  try {
    await seedFixtureCards(home, [
      deepLinkFixtureCard(cardAId, cardAIdentifier),
      deepLinkFixtureCard(cardBId, cardBIdentifier),
    ]);
    boot = bootServerAt(home);
    await waitForReady(SANDBOX_PORT);

    chrome = launchChrome();
    await waitForCdpUp();
    cdp = await connectCDP();

    const url = `http://127.0.0.1:${SANDBOX_PORT}/?card=${encodeURIComponent(cardBId)}`;
    const { sessionId } = await openPage(cdp, { url });

    const detailPanelTextProbe = `
      (function () {
        var panel = document.querySelector('[aria-label="Ticket detail"]');
        return panel ? panel.textContent : null;
      })()
    `;
    const deadline = Date.now() + DEEP_LINK_PARAM_RENDER_TIMEOUT_MS;
    let panelText = null;
    while (Date.now() < deadline) {
      try {
        const value = await evalValue(cdp, sessionId, detailPanelTextProbe);
        if (typeof value === "string" && value.includes(cardBIdentifier)) {
          panelText = value;
          break;
        }
      } catch {
        // page mid-navigation, keep polling
      }
      await sleep(POLL_INTERVAL_MS);
    }
    if (panelText == null) {
      violations.push(
        `deep-link-param-opens-card: detail panel never rendered the target card's identifier ` +
          `${JSON.stringify(cardBIdentifier)} within ${DEEP_LINK_PARAM_RENDER_TIMEOUT_MS}ms`,
      );
    } else if (panelText.includes(cardAIdentifier)) {
      violations.push(
        `deep-link-param-opens-card: detail panel also rendered the non-target card's ` +
          `identifier ${JSON.stringify(cardAIdentifier)}, expected only ` +
          `${JSON.stringify(cardBIdentifier)}`,
      );
    }

    const search = await evalValue(cdp, sessionId, "window.location.search");
    if (typeof search !== "string" || search.includes("card")) {
      violations.push(
        `deep-link-param-opens-card: window.location.search still contains "card" after the ` +
          `deep-link effect ran: ${JSON.stringify(search)}`,
      );
    }
    const pathname = await evalValue(
      cdp,
      sessionId,
      "window.location.pathname",
    );
    if (pathname !== "/") {
      violations.push(
        `deep-link-param-opens-card: window.location.pathname changed to ` +
          `${JSON.stringify(pathname)}, expected it unchanged ("/")`,
      );
    }
  } finally {
    if (cdp) cdp.close();
    await stopServer(chrome);
    rmSync(chromeUserDataDir(), { recursive: true, force: true });
    await stopServer(boot?.child);
    cleanupSandboxHome(home);
  }
}

const DEEP_LINK_PARAM_BREAK_TARGET = 'params.get("card")';
const DEEP_LINK_PARAM_BREAK_REPLACEMENT =
  'params.get("panel110-break-never-sent-param")';

/** `--break deep-link-param-opens-card`: changes the parameter name App.tsx's cold-open effect
 * reads from `card` to a name the check never sends (replaces the sole `params.get("card")` call
 * site), rebuilds via `resetBuildCache()`, and requires the SAME check function to report the
 * resulting "detail panel never rendered" violation (trip leg). Restores the captured bytes
 * unconditionally in a `finally`, rebuilds, and requires a clean pass (restore leg). */
async function runBreakDeepLinkParamOpensCard() {
  assertBuilt();
  const original = readFileSync(APP_TSX_PATH, "utf8");
  const occurrences = original.split(DEEP_LINK_PARAM_BREAK_TARGET).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `panel110: refusing to run --break deep-link-param-opens-card, expected ` +
        `${JSON.stringify(DEEP_LINK_PARAM_BREAK_TARGET)} to occur exactly once in ` +
        `${APP_TSX_PATH}, measured ${occurrences}. A miscounted anchor would mutate the wrong ` +
        `spot and report a false "the check cannot fail".`,
    );
  }

  let tripFired = false;
  registerRestore(APP_TSX_PATH, original);
  try {
    writeFileSync(
      APP_TSX_PATH,
      original.replace(
        DEEP_LINK_PARAM_BREAK_TARGET,
        DEEP_LINK_PARAM_BREAK_REPLACEMENT,
      ),
    );
    resetBuildCache();

    const tripViolations = [];
    await checkDeepLinkParamOpensCard(tripViolations);
    console.log(
      `\n--break deep-link-param-opens-card TRIP leg output:\n${tripViolations.join("\n") || "(no violations)"}`,
    );
    tripFired = tripViolations.some((v) =>
      v.includes("detail panel never rendered the target card's identifier"),
    );
  } finally {
    writeFileSync(APP_TSX_PATH, original);
    resetBuildCache();
    unregisterRestore(APP_TSX_PATH);
  }

  const restoreViolations = [];
  await checkDeepLinkParamOpensCard(restoreViolations);
  const restoreClean = restoreViolations.length === 0;
  console.log(
    `--break deep-link-param-opens-card RESTORE leg: ${restoreClean ? "PASS" : `FAIL:\n${restoreViolations.join("\n")}`}`,
  );

  return { tripFired, restoreClean };
}

const SW_PATH = join(REPO_ROOT, "src/web/public/sw.js");
const NOTIF_TIMEOUT_MS = 20_000;

/** Boots the sandbox, seeds one fixture card, launches Chrome, grants notifications, makes the
 * service worker ready, and drives three real `deliverPushToServiceWorker` calls: card A, card A
 * again with a different body (must REPLACE, not stack), then card B (the positive control
 * proving the count assertion isn't passing because notifications never appear at all). Also
 * greps the SERVED sw.js (the built asset the sandbox server actually answers with, not the repo
 * file, so a build that silently drops the option is caught) for `renotify: true`. */
async function checkTagRenotifyReplace(violations) {
  assertBuilt();
  const home = makeSandboxHome("tag-renotify-replace");
  const cardAId = "panel-110-tag-renotify-card-a";
  const cardAIdentifier = "PANEL-110-07-TAG-A";
  const cardBId = "panel-110-tag-renotify-card-b";
  const origin = `http://127.0.0.1:${SANDBOX_PORT}`;

  let boot;
  let chrome;
  let cdp;
  try {
    await seedFixtureCards(home, [
      deepLinkFixtureCard(cardAId, cardAIdentifier),
    ]);
    boot = bootServerAt(home);
    await waitForReady(SANDBOX_PORT);

    chrome = launchChrome();
    await waitForCdpUp();
    cdp = await connectCDP();

    const { sessionId } = await openPage(cdp, { url: `${origin}/` });
    await grantNotifications(cdp, origin);
    await ensureServiceWorkerReady(cdp, sessionId);

    const registrationId = await deliverPushToServiceWorker(cdp, sessionId, {
      origin,
      data: {
        title: "panel-110 tag-renotify",
        body: "first delivery",
        cardId: cardAId,
        url: `${origin}/?card=${encodeURIComponent(cardAId)}`,
      },
    });

    const afterFirst = await pollServiceWorkerNotifications(
      cdp,
      sessionId,
      (list) => list.some((n) => n.tag === cardAId),
      NOTIF_TIMEOUT_MS,
    );
    const firstForA = afterFirst.filter((n) => n.tag === cardAId);
    if (firstForA.length !== 1) {
      violations.push(
        `tag-renotify-replace: expected exactly 1 notification tagged ${JSON.stringify(cardAId)} ` +
          `after the first delivery, observed ${firstForA.length} (${JSON.stringify(afterFirst)})`,
      );
    }

    await deliverPushToServiceWorker(cdp, sessionId, {
      origin,
      registrationId,
      data: {
        title: "panel-110 tag-renotify",
        body: "second delivery, replaces the first",
        cardId: cardAId,
        url: `${origin}/?card=${encodeURIComponent(cardAId)}`,
      },
    });

    const afterSecond = await pollServiceWorkerNotifications(
      cdp,
      sessionId,
      (list) =>
        list.some(
          (n) =>
            n.tag === cardAId &&
            n.body === "second delivery, replaces the first",
        ),
      NOTIF_TIMEOUT_MS,
    );
    const secondForA = afterSecond.filter((n) => n.tag === cardAId);
    if (secondForA.length !== 1) {
      violations.push(
        `tag-renotify-replace: expected exactly 1 notification tagged ${JSON.stringify(cardAId)} ` +
          `after the second delivery (replace, not stack), observed ${secondForA.length} ` +
          `(${JSON.stringify(afterSecond)})`,
      );
    } else if (secondForA[0].body !== "second delivery, replaces the first") {
      violations.push(
        `tag-renotify-replace: after the second delivery the notification body was ` +
          `${JSON.stringify(secondForA[0].body)}, expected the second delivery's body, so it ` +
          `was not actually replaced`,
      );
    }

    await deliverPushToServiceWorker(cdp, sessionId, {
      origin,
      registrationId,
      data: {
        title: "panel-110 tag-renotify",
        body: "different card",
        cardId: cardBId,
        url: `${origin}/?card=${encodeURIComponent(cardBId)}`,
      },
    });
    const afterThird = await pollServiceWorkerNotifications(
      cdp,
      sessionId,
      (list) => list.some((n) => n.tag === cardBId),
      NOTIF_TIMEOUT_MS,
    );
    if (afterThird.length !== 2) {
      violations.push(
        `tag-renotify-replace: expected 2 notifications after delivering a DIFFERENT card (the ` +
          `positive control proving notifications can actually appear at all), observed ` +
          `${afterThird.length} (${JSON.stringify(afterThird)})`,
      );
    }

    const servedSwSource = await (await fetch(`${origin}/sw.js`)).text();
    if (
      !servedSwSource.includes("renotify: true") &&
      !servedSwSource.includes("renotify:true")
    ) {
      violations.push(
        `tag-renotify-replace: the served sw.js does not contain "renotify: true" in its push ` +
          `handler`,
      );
    }
  } finally {
    if (cdp) cdp.close();
    await stopServer(chrome);
    rmSync(chromeUserDataDir(), { recursive: true, force: true });
    await stopServer(boot?.child);
    cleanupSandboxHome(home);
  }
}

const TAG_RENOTIFY_BREAK_TARGET = "tag: data.cardId,";
const TAG_RENOTIFY_BREAK_REPLACEMENT =
  "tag: `panel110-break-unique-${Date.now()}-${Math.random()}`,";

/** `--break tag-renotify-replace`: replaces the sole `tag: data.cardId,` call site in `sw.js`'s
 * push handler with a per-message unique tag, rebuilds via `resetBuildCache()`, and requires the
 * SAME check function to report the resulting "still exactly one" violation (a per-message unique
 * tag means the second delivery no longer replaces the first, so the check should observe TWO
 * notifications tagged the same card id instead of one). Restores the captured bytes
 * unconditionally in a `finally`, rebuilds, and requires a clean pass (restore leg). */
async function runBreakTagRenotifyReplace() {
  assertBuilt();
  const original = readFileSync(SW_PATH, "utf8");
  const occurrences = original.split(TAG_RENOTIFY_BREAK_TARGET).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `panel110: refusing to run --break tag-renotify-replace, expected ` +
        `${JSON.stringify(TAG_RENOTIFY_BREAK_TARGET)} to occur exactly once in ${SW_PATH}, ` +
        `measured ${occurrences}. A miscounted anchor would mutate the wrong spot and report a ` +
        `false "the check cannot fail".`,
    );
  }

  let tripFired = false;
  registerRestore(SW_PATH, original);
  try {
    writeFileSync(
      SW_PATH,
      original.replace(
        TAG_RENOTIFY_BREAK_TARGET,
        TAG_RENOTIFY_BREAK_REPLACEMENT,
      ),
    );
    resetBuildCache();

    const tripViolations = [];
    await checkTagRenotifyReplace(tripViolations);
    console.log(
      `\n--break tag-renotify-replace TRIP leg output:\n${tripViolations.join("\n") || "(no violations)"}`,
    );
    tripFired = tripViolations.some((v) =>
      v.includes("expected exactly 1 notification tagged"),
    );
  } finally {
    writeFileSync(SW_PATH, original);
    resetBuildCache();
    unregisterRestore(SW_PATH);
  }

  const restoreViolations = [];
  await checkTagRenotifyReplace(restoreViolations);
  const restoreClean = restoreViolations.length === 0;
  console.log(
    `--break tag-renotify-replace RESTORE leg: ${restoreClean ? "PASS" : `FAIL:\n${restoreViolations.join("\n")}`}`,
  );

  return { tripFired, restoreClean };
}

const NOTIF_CLICK_OPEN_TIMEOUT_MS = 8_000;

/** Boots the sandbox, seeds two fixture cards, launches Chrome, grants notifications, makes the
 * service worker ready, and delivers a real push for the SECOND card. Drives a synthetic
 * `notificationclick` from inside the worker's own scope (settled empirically: a script
 * constructed `NotificationEvent` can `close()` the notification and run the handler's async body
 * fine, but `client.focus()` throws `InvalidAccessError` regardless of page-level user
 * activation, since Chromium only grants window-interaction for a NATIVE notification-click
 * dispatch, never a script-constructed one; sw.js was hardened with a `try/catch` around
 * `focus()` so a focus failure never blocks the `postMessage` that follows it, see Plan 07's
 * summary). The focus branch (message + detail panel + notification closed) is a hard gate; the
 * open-window branch is a soft, retried assertion that degrades to a static source check and a
 * logged warning rather than ever failing the check once the focus branch has passed. */
async function checkNotificationclickFocusOrOpen(violations) {
  assertBuilt();
  const home = makeSandboxHome("notificationclick-focus-or-open");
  const cardAId = "panel-110-notif-click-card-a";
  const cardAIdentifier = "PANEL-110-07-CLICK-A";
  const cardBId = "panel-110-notif-click-card-b";
  const cardBIdentifier = "PANEL-110-07-CLICK-B";
  const origin = `http://127.0.0.1:${SANDBOX_PORT}`;

  let boot;
  let chrome;
  let cdp;
  try {
    await seedFixtureCards(home, [
      deepLinkFixtureCard(cardAId, cardAIdentifier),
      deepLinkFixtureCard(cardBId, cardBIdentifier),
    ]);
    boot = bootServerAt(home);
    await waitForReady(SANDBOX_PORT);

    chrome = launchChrome();
    await waitForCdpUp();
    cdp = await connectCDP();

    let page = await openPage(cdp, { url: `${origin}/` });
    await grantNotifications(cdp, origin);
    await ensureServiceWorkerReady(cdp, page.sessionId);

    await evalValue(
      cdp,
      page.sessionId,
      `window.__panel110ClickMessages = []; navigator.serviceWorker.addEventListener("message", (e) => window.__panel110ClickMessages.push(e.data)); true`,
    );

    const registrationId = await deliverPushToServiceWorker(
      cdp,
      page.sessionId,
      {
        origin,
        data: {
          title: "panel-110 notif click",
          body: "focus branch",
          cardId: cardBId,
          url: `${origin}/?card=${encodeURIComponent(cardBId)}`,
        },
      },
    );
    await pollServiceWorkerNotifications(
      cdp,
      page.sessionId,
      (list) => list.some((n) => n.tag === cardBId),
      NOTIF_TIMEOUT_MS,
    );

    let sw = await attachToServiceWorkerTarget(cdp, origin);
    const dispatchFocus = await evalAsyncValue(
      cdp,
      sw.sessionId,
      `(async () => {
        const notifs = await self.registration.getNotifications();
        const target = notifs.find((n) => n.tag === ${JSON.stringify(cardBId)});
        if (!target) return { error: "no live notification for tag" };
        self.dispatchEvent(new NotificationEvent("notificationclick", { notification: target }));
        return { dispatched: true };
      })()`,
    );
    if (dispatchFocus?.error) {
      violations.push(
        `notificationclick-focus-or-open: ${dispatchFocus.error} before the focus-branch dispatch`,
      );
    }

    const messagesRaw = await pollUntilTruthy(
      cdp,
      page.sessionId,
      `window.__panel110ClickMessages.length > 0 ? JSON.stringify(window.__panel110ClickMessages) : null`,
      NOTIF_CLICK_OPEN_TIMEOUT_MS,
    );
    const messages = messagesRaw ? JSON.parse(messagesRaw) : [];
    const matched = messages.find(
      (m) => m?.type === "dsp-open-card" && m?.cardId === cardBId,
    );
    if (!matched) {
      violations.push(
        `notificationclick-focus-or-open: page never recorded a "dsp-open-card" message for ` +
          `${JSON.stringify(cardBId)} within ${NOTIF_CLICK_OPEN_TIMEOUT_MS}ms, observed ` +
          `${JSON.stringify(messages)}`,
      );
    }

    const detailPanelTextProbe = `
      (function () {
        var panel = document.querySelector('[aria-label="Ticket detail"]');
        return panel ? panel.textContent : null;
      })()
    `;
    const panelText = await pollUntilTruthy(
      cdp,
      page.sessionId,
      `(function(){var t=${detailPanelTextProbe}; return (t && t.includes(${JSON.stringify(cardBIdentifier)})) ? t : null;})()`,
      NOTIF_CLICK_OPEN_TIMEOUT_MS,
    );
    if (panelText == null) {
      violations.push(
        `notificationclick-focus-or-open: detail panel never showed the clicked card's ` +
          `identifier ${JSON.stringify(cardBIdentifier)} within ${NOTIF_CLICK_OPEN_TIMEOUT_MS}ms`,
      );
    } else if (panelText.includes(cardAIdentifier)) {
      violations.push(
        `notificationclick-focus-or-open: detail panel showed the non-clicked card's identifier ` +
          `${JSON.stringify(cardAIdentifier)}, expected only ${JSON.stringify(cardBIdentifier)}`,
      );
    }

    const afterClick = await pollServiceWorkerNotifications(
      cdp,
      page.sessionId,
      (list) => !list.some((n) => n.tag === cardBId),
      NOTIF_CLICK_OPEN_TIMEOUT_MS,
    );
    if (afterClick.some((n) => n.tag === cardBId)) {
      violations.push(
        `notificationclick-focus-or-open: the clicked notification tagged ` +
          `${JSON.stringify(cardBId)} is still listed by getNotifications() after the click, ` +
          `expected it closed`,
      );
    }

    // Open-window branch: close the page so no client matches the origin, redeliver a fresh
    // notification (the first was already closed above), and dispatch again.
    await cdp.send("Target.closeTarget", { targetId: page.targetId });
    await deliverPushToServiceWorker(cdp, page.sessionId, {
      origin,
      registrationId,
      data: {
        title: "panel-110 notif click",
        body: "open branch",
        cardId: cardBId,
        url: `${origin}/?card=${encodeURIComponent(cardBId)}`,
      },
    }).catch(() => {
      // The page session that issued the delivery just closed with its target; a later attach
      // below re-resolves everything the open-branch dispatch needs from the worker's own scope.
    });

    sw = await attachToServiceWorkerTarget(cdp, origin);
    const beforeOpenTargetIds = new Set(
      (await cdp.send("Target.getTargets", {})).targetInfos
        .filter((t) => t.type === "page")
        .map((t) => t.targetId),
    );
    await evalAsyncValue(
      cdp,
      sw.sessionId,
      `(async () => {
        const notifs = await self.registration.getNotifications();
        const target = notifs[notifs.length - 1];
        if (!target) return { error: "no live notification for the open-window dispatch" };
        self.__panel110OpenWindowCalls = [];
        const realOpenWindow = self.clients.openWindow.bind(self.clients);
        self.clients.openWindow = (u) => {
          self.__panel110OpenWindowCalls.push(String(u));
          return realOpenWindow(u);
        };
        self.dispatchEvent(new NotificationEvent("notificationclick", { notification: target }));
        return { dispatched: true };
      })()`,
    );

    const deadline = Date.now() + NOTIF_CLICK_OPEN_TIMEOUT_MS;
    let newPageTarget = null;
    while (Date.now() < deadline && newPageTarget == null) {
      const { targetInfos } = await cdp.send("Target.getTargets", {});
      newPageTarget = targetInfos.find(
        (t) =>
          t.type === "page" &&
          !beforeOpenTargetIds.has(t.targetId) &&
          t.url.includes("card="),
      );
      if (newPageTarget == null) await sleep(POLL_INTERVAL_MS);
    }

    if (newPageTarget != null) {
      console.log(
        `notificationclick-focus-or-open: open-window branch verified live, a new page target ` +
          `opened at ${newPageTarget.url}`,
      );
    } else {
      console.log(
        `notificationclick-focus-or-open: WARNING open-window branch degraded, no new page ` +
          `target observed within ${NOTIF_CLICK_OPEN_TIMEOUT_MS}ms (a synthetic notificationclick ` +
          `carries no user activation, which clients.openWindow requires); asserting on the ` +
          `recorded clients.openWindow call instead, with a source grep as the floor`,
      );
      const openWindowCalls = await evalAsyncValue(
        cdp,
        sw.sessionId,
        `(async () => self.__panel110OpenWindowCalls ?? [])()`,
      );
      const openedDeepLink = (openWindowCalls ?? []).find((u) => {
        try {
          return new URL(u).searchParams.get("card") === cardBId;
        } catch {
          return false;
        }
      });
      if (openedDeepLink == null) {
        violations.push(
          `notificationclick-focus-or-open: the open-window branch never called ` +
            `clients.openWindow with a URL carrying card=${cardBId}, recorded calls: ` +
            `${JSON.stringify(openWindowCalls)} (proves the branch ran even when Chrome ` +
            `refuses the actual window)`,
        );
      } else {
        console.log(
          `notificationclick-focus-or-open: open-window branch verified via recorded ` +
            `clients.openWindow(${JSON.stringify(openedDeepLink)})`,
        );
      }
      const servedSwSource = await (await fetch(`${origin}/sw.js`)).text();
      if (!servedSwSource.includes("clients.openWindow(url)")) {
        violations.push(
          `notificationclick-focus-or-open: served sw.js does not call clients.openWindow(url) ` +
            `in its notificationclick else branch`,
        );
      }
    }
  } finally {
    if (cdp) cdp.close();
    await stopServer(chrome);
    rmSync(chromeUserDataDir(), { recursive: true, force: true });
    await stopServer(boot?.child);
    cleanupSandboxHome(home);
  }
}

const NOTIF_CLICK_BREAK_TARGET = `self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url;
  const cardId = event.notification.data?.cardId ?? event.notification.tag;
  const hasCard = typeof cardId === "string" && cardId !== "";
  if (!hasCard && typeof url !== "string") return;
  event.waitUntil(
    (async () => {
      const all = await clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      const existing =
        typeof url === "string"
          ? all.find(
              (client) => new URL(client.url).origin === new URL(url).origin,
            )
          : all[0];
      if (existing) {
        try {
          await existing.focus();
        } catch {
          // A browser may refuse focus (no user-activation context); still route the card.
        }
        if (hasCard) existing.postMessage({ type: "dsp-open-card", cardId });
      } else if (typeof url === "string") {
        await clients.openWindow(url);
      }
    })(),
  );
});`;
const NOTIF_CLICK_BREAK_REPLACEMENT = `self.addEventListener("notificationclick", (event) => {});`;

/** `--break notificationclick-focus-or-open`: empties the entire `notificationclick` handler body
 * (the sole occurrence of the handler, matched verbatim so a miscounted anchor can never mutate
 * the wrong spot), rebuilds via `resetBuildCache()`, and requires the SAME check function to
 * report the resulting "page never recorded a message" violation (trip leg). Restores the
 * captured bytes unconditionally in a `finally`, rebuilds, and requires a clean pass (restore
 * leg). */
async function runBreakNotificationclickFocusOrOpen() {
  assertBuilt();
  const original = readFileSync(SW_PATH, "utf8");
  const occurrences = original.split(NOTIF_CLICK_BREAK_TARGET).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `panel110: refusing to run --break notificationclick-focus-or-open, expected the verbatim ` +
        `notificationclick handler to occur exactly once in ${SW_PATH}, measured ${occurrences}. ` +
        `A miscounted anchor would mutate the wrong spot and report a false "the check cannot ` +
        `fail".`,
    );
  }

  let tripFired = false;
  registerRestore(SW_PATH, original);
  try {
    writeFileSync(
      SW_PATH,
      original.replace(NOTIF_CLICK_BREAK_TARGET, NOTIF_CLICK_BREAK_REPLACEMENT),
    );
    resetBuildCache();

    const tripViolations = [];
    await checkNotificationclickFocusOrOpen(tripViolations);
    console.log(
      `\n--break notificationclick-focus-or-open TRIP leg output:\n${tripViolations.join("\n") || "(no violations)"}`,
    );
    tripFired = tripViolations.some((v) => v.includes("page never recorded a"));
  } finally {
    writeFileSync(SW_PATH, original);
    resetBuildCache();
    unregisterRestore(SW_PATH);
  }

  const restoreViolations = [];
  await checkNotificationclickFocusOrOpen(restoreViolations);
  const restoreClean = restoreViolations.length === 0;
  console.log(
    `--break notificationclick-focus-or-open RESTORE leg: ${restoreClean ? "PASS" : `FAIL:\n${restoreViolations.join("\n")}`}`,
  );

  return { tripFired, restoreClean };
}

// ---------------------------------------------------------------------------
// needs-input-delivers (Plan 08's own new capability): the phase's one check
// judged by a real external push service instead of this repo's own stub or
// decrypt logic. A real headless-Chrome subscribe (mirroring src/web/lib/
// push.ts's own register/fetch-key/subscribe/POST sequence, no synthetic
// endpoint) feeds a real NEEDS_INPUT transition's real send.
// ---------------------------------------------------------------------------

const NEEDS_INPUT_DELIVERS_MAX_ATTEMPTS = 2;
const NEEDS_INPUT_DELIVERS_ATTEMPT_TIMEOUT_MS = 60_000;
const NEEDS_INPUT_DELIVERS_TIER_ONE_TIMEOUT_MS = 45_000;
/** Mirrors `push-send.ts`'s own private `ENDPOINT_LOG_PREFIX_LEN`: the server never logs more of
 * an endpoint than this, so this is also as much of it as this check can match against. */
const ENDPOINT_LOG_PREFIX_LEN = 40;

/** Runs inside the sandboxed page via `evalAsyncValue`. Mirrors `src/web/lib/push.ts`'s
 * `enablePush` exactly: register `/sw.js`, fetch the real VAPID public key, convert it with the
 * same padding and character swap, `pushManager.subscribe()` against the REAL push service (no
 * timeout race and no `unsubscribe()` at the end, unlike `panel-109.mjs`'s `fcm-egress` probe:
 * this check needs the subscription to survive so the drive/send legs below can use it), then POST
 * `subscription.toJSON()` to `/api/push/subscribe`, exactly what the shipped client does. */
const REAL_SUBSCRIBE_PAGE_EXPRESSION = `
(async () => {
  try {
    const registration = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;
    const { publicKey } = await fetch("/api/push/public-key").then((r) =>
      r.json(),
    );
    const padding = "=".repeat((4 - (publicKey.length % 4)) % 4);
    const base64 = (publicKey + padding).replace(/-/g, "+").replace(/_/g, "/");
    const rawData = atob(base64);
    const bytes = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; i++) bytes[i] = rawData.charCodeAt(i);
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: bytes,
    });
    const res = await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(subscription.toJSON()),
    });
    return {
      ok: res.ok,
      status: res.status,
      endpoint: subscription.endpoint,
      errorName: null,
      errorMessage: null,
    };
  } catch (err) {
    return {
      ok: false,
      status: null,
      endpoint: null,
      errorName: err && err.name ? err.name : null,
      errorMessage: err && err.message ? err.message : String(err),
    };
  }
})()
`;

/** Scans `log` for every `[push] send <status> <endpointPrefix>` line (the exact shape
 * `sendPushForCard` emits) and returns the LAST observed status for that exact prefix, or `null`
 * if the prefix never appeared. */
function findPushSendLogStatus(log, endpointPrefix) {
  const re = /\[push\] send (\d+) (\S+)/g;
  let match;
  let status = null;
  while ((match = re.exec(log)) != null) {
    if (match[2] === endpointPrefix) status = Number(match[1]);
  }
  return status;
}

/**
 * One bounded attempt of the whole real sequence: fresh sandbox, real headless-Chrome subscribe
 * against the real push service, an independent `push_subscriptions` read (never trusting the
 * page's own claim), a real `NEEDS_INPUT` marker, the tier-one hard gate (a real 2xx `[push] send`
 * log line for the stored endpoint), and the tier-two soft assertion (inbound receipt via
 * `getNotifications`). Returns one of:
 *   `{ outcome: "subscribe-failed", detail }` - subscribe or the POST failed, or the row never
 *     landed in `push_subscriptions`
 *   `{ outcome: "tier-one-failed", detail, status? }` - no matching send log line, or a non-2xx
 *   `{ outcome: "success", status, endpointPrefix, tierTwo }`
 */
async function attemptNeedsInputDelivers(attemptNum) {
  const attemptDeadline = Date.now() + NEEDS_INPUT_DELIVERS_ATTEMPT_TIMEOUT_MS;
  const home = makeSandboxHome(`needs-input-delivers-${attemptNum}`);
  const cardId = `panel-110-needs-input-delivers-${attemptNum}-${process.pid}`;
  const identifier = "PANEL-110-08";
  const sessionUuid = randomUUID();
  const tmuxName = `${SANDBOX_PREFIX}deliver-pane-${attemptNum}-${process.pid}`;
  const reason = `panel-110-deliver-reason-${process.pid}-${Date.now()}-${attemptNum}`;
  let boot;
  let chromeChild;
  let cdp;
  try {
    await startTmuxPane(tmuxName);
    await seedNeedsInputCard(home, {
      cardId,
      identifier,
      sessionId: sessionUuid,
      tmuxSession: tmuxName,
    });
    boot = bootServerAt(home);
    await waitForReady(SANDBOX_PORT);

    chromeChild = launchChrome();
    await waitForCdpUp();
    cdp = await connectCDP();

    const origin = `http://127.0.0.1:${SANDBOX_PORT}`;
    await grantNotifications(cdp, origin);
    const { sessionId: pageSessionId } = await openPage(cdp, {
      url: `${origin}/`,
    });
    await ensureServiceWorkerReady(cdp, pageSessionId);

    const subscribeResult = await evalAsyncValue(
      cdp,
      pageSessionId,
      REAL_SUBSCRIBE_PAGE_EXPRESSION,
    );
    if (!subscribeResult.ok) {
      return {
        outcome: "subscribe-failed",
        detail:
          `real subscribe/POST did not succeed: status=${subscribeResult.status} ` +
          `errorName=${subscribeResult.errorName} errorMessage=${subscribeResult.errorMessage}`,
      };
    }

    const dbPath = join(home, ".dispatch", "board.db");
    const rows = await pollPushDbRows(
      dbPath,
      (r) => r.some((row) => row.endpoint === subscribeResult.endpoint),
      10_000,
    );
    const row = rows.find((r) => r.endpoint === subscribeResult.endpoint);
    if (row == null) {
      return {
        outcome: "subscribe-failed",
        detail: `subscribed endpoint never landed in push_subscriptions (prefix ${subscribeResult.endpoint.slice(0, ENDPOINT_LOG_PREFIX_LEN)})`,
      };
    }

    await driveMarker(tmuxName, "NEEDS_INPUT", reason);

    const endpointPrefix = row.endpoint.slice(0, ENDPOINT_LOG_PREFIX_LEN);
    const tierOneDeadline = Math.min(
      Date.now() + NEEDS_INPUT_DELIVERS_TIER_ONE_TIMEOUT_MS,
      attemptDeadline,
    );
    let observedStatus = null;
    while (Date.now() < tierOneDeadline) {
      observedStatus = findPushSendLogStatus(boot.log(), endpointPrefix);
      if (observedStatus != null) break;
      await sleep(POLL_INTERVAL_MS);
    }

    if (observedStatus == null) {
      return {
        outcome: "tier-one-failed",
        detail: `no "[push] send <status> ${endpointPrefix}" line observed in the sandbox server log within ${NEEDS_INPUT_DELIVERS_TIER_ONE_TIMEOUT_MS}ms`,
      };
    }
    if (observedStatus < 200 || observedStatus >= 300) {
      return {
        outcome: "tier-one-failed",
        detail: `real push service responded ${observedStatus} for endpoint prefix ${endpointPrefix}, expected a 2xx status`,
        status: observedStatus,
      };
    }

    let tierTwo;
    const tierTwoTimeoutMs = attemptDeadline - Date.now();
    if (tierTwoTimeoutMs > 0) {
      const notifications = await pollServiceWorkerNotifications(
        cdp,
        pageSessionId,
        (list) => list.some((n) => n.tag === cardId),
        tierTwoTimeoutMs,
      );
      tierTwo = notifications.some((n) => n.tag === cardId)
        ? { observed: true, note: null }
        : {
            observed: false,
            note:
              `WARNING: tier two (headless inbound receipt) never observed a notification tagged ` +
              `${JSON.stringify(cardId)} within the remaining attempt window - a known limitation ` +
              `of headless Chrome's inbound push connection (see 109-05), not a violation since ` +
              `tier one already passed`,
          };
    } else {
      tierTwo = {
        observed: false,
        note: "WARNING: no attempt time remained to poll tier two after tier one passed",
      };
    }

    return {
      outcome: "success",
      status: observedStatus,
      endpointPrefix,
      tierTwo,
    };
  } finally {
    if (cdp) cdp.close();
    await stopServer(chromeChild);
    rmSync(chromeUserDataDir(), { recursive: true, force: true });
    await killTmuxPane(tmuxName);
    await stopServer(boot?.child);
    cleanupSandboxHome(home);
  }
}

/** At most `NEEDS_INPUT_DELIVERS_MAX_ATTEMPTS` bounded attempts of the whole sequence, per the
 * measured ~38% transient failure rate against the real push service (109-05's `fcm-egress`
 * verdict). A subscribe failure on BOTH attempts is a violation (outbound reachability is already
 * proven, so two consecutive failures point at a real problem, matching the 109
 * `subscribe-round-trip` precedent). A tier-one failure (missing or non-2xx send) is reported for
 * whichever attempt(s) reached it. Tier two is recorded, never a violation when tier one passed. */
async function checkNeedsInputDelivers(violations) {
  assertBuilt();
  const attemptResults = [];
  let success = null;
  for (
    let attempt = 1;
    attempt <= NEEDS_INPUT_DELIVERS_MAX_ATTEMPTS;
    attempt++
  ) {
    const result = await attemptNeedsInputDelivers(attempt);
    console.log(
      `needs-input-delivers: attempt ${attempt}/${NEEDS_INPUT_DELIVERS_MAX_ATTEMPTS} outcome=${result.outcome}` +
        (result.detail ? ` (${result.detail})` : ""),
    );
    attemptResults.push(result);
    if (result.outcome === "success") {
      success = result;
      break;
    }
  }

  if (success) {
    console.log(
      `needs-input-delivers: real push service accepted the send, observed HTTP status ${success.status}`,
    );
    console.log(
      success.tierTwo.observed
        ? "needs-input-delivers: tier two (headless inbound receipt) observed the notification"
        : `needs-input-delivers: ${success.tierTwo.note}`,
    );
    return;
  }

  if (attemptResults.every((r) => r.outcome === "subscribe-failed")) {
    violations.push(
      `needs-input-delivers: real subscribe failed on all ${attemptResults.length} attempt(s): ` +
        attemptResults.map((r) => r.detail).join(" | "),
    );
    return;
  }

  for (const r of attemptResults) {
    violations.push(
      `needs-input-delivers: attempt outcome=${r.outcome}: ${r.detail}`,
    );
  }
}

const NEEDS_INPUT_DELIVERS_BREAK_TARGET =
  "Authorization: `vapid t=${jwt}, k=${vapid.publicKeyBase64Url}`,";
const NEEDS_INPUT_DELIVERS_BREAK_REPLACEMENT =
  "Authorization: `vapid t=${jwt}`,";

/** `--break needs-input-delivers`: strips the `k=` parameter from the Authorization header value
 * in `push-send.ts`, so the real push service can no longer resolve the signing key, rebuilds via
 * `resetBuildCache()`, and requires the SAME check function to report a tier-one non-2xx violation
 * (trip leg): subscribing is unaffected (the Authorization header is never sent to FCM until the
 * send leg), so the failure this trip proves is specifically that the real push service rejects a
 * VAPID header it cannot verify, the opposite-direction proof for T-110-31. Restores the captured
 * bytes unconditionally in a `finally`, rebuilds, and requires a clean pass (restore leg). */
async function runBreakNeedsInputDelivers() {
  assertBuilt();
  const original = readFileSync(PUSH_SEND_TS_PATH, "utf8");
  const occurrences =
    original.split(NEEDS_INPUT_DELIVERS_BREAK_TARGET).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `panel110: refusing to run --break needs-input-delivers, expected ` +
        `${JSON.stringify(NEEDS_INPUT_DELIVERS_BREAK_TARGET)} to occur exactly once in ` +
        `${PUSH_SEND_TS_PATH}, measured ${occurrences}. A miscounted anchor would mutate the ` +
        `wrong spot and report a false "the check cannot fail".`,
    );
  }

  let tripFired = false;
  registerRestore(PUSH_SEND_TS_PATH, original);
  try {
    writeFileSync(
      PUSH_SEND_TS_PATH,
      original.replace(
        NEEDS_INPUT_DELIVERS_BREAK_TARGET,
        NEEDS_INPUT_DELIVERS_BREAK_REPLACEMENT,
      ),
    );
    resetBuildCache();

    const tripViolations = [];
    await checkNeedsInputDelivers(tripViolations);
    console.log(
      `\n--break needs-input-delivers TRIP leg output:\n${tripViolations.join("\n") || "(no violations)"}`,
    );
    tripFired = tripViolations.some(
      (v) =>
        v.includes("tier-one-failed") && v.includes("expected a 2xx status"),
    );
  } finally {
    writeFileSync(PUSH_SEND_TS_PATH, original);
    resetBuildCache();
    unregisterRestore(PUSH_SEND_TS_PATH);
  }

  const restoreViolations = [];
  await checkNeedsInputDelivers(restoreViolations);
  const restoreClean = restoreViolations.length === 0;
  console.log(
    `--break needs-input-delivers RESTORE leg: ${restoreClean ? "PASS" : `FAIL:\n${restoreViolations.join("\n")}`}`,
  );

  return { tripFired, restoreClean };
}

// ---------------------------------------------------------------------------
// CHECKS / BREAKS / PROBES registries. Every later plan in this phase
// appends here.
// ---------------------------------------------------------------------------

const CHECKS = {
  "needs-input-trigger-fires": (violations) =>
    checkNeedsInputTriggerFires(violations),
  "push-envelope-decrypts": (violations) =>
    checkPushEnvelopeDecrypts(violations),
  "agent-done-no-push": (violations) => checkAgentDoneNoPush(violations),
  "multi-device-prune": (violations) => checkMultiDevicePrune(violations),
  "per-origin-deep-link": (violations) => checkPerOriginDeepLink(violations),
  "deep-link-param-opens-card": (violations) =>
    checkDeepLinkParamOpensCard(violations),
  "tag-renotify-replace": (violations) => checkTagRenotifyReplace(violations),
  "notificationclick-focus-or-open": (violations) =>
    checkNotificationclickFocusOrOpen(violations),
  "needs-input-delivers": (violations) => checkNeedsInputDelivers(violations),
};

const BREAKS = {
  "needs-input-trigger-fires": runBreakNeedsInputTriggerFires,
  "push-envelope-decrypts": runBreakPushEnvelopeDecrypts,
  "agent-done-no-push": runBreakAgentDoneNoPush,
  "multi-device-prune": runBreakMultiDevicePrune,
  "per-origin-deep-link": runBreakPerOriginDeepLink,
  "deep-link-param-opens-card": runBreakDeepLinkParamOpensCard,
  "tag-renotify-replace": runBreakTagRenotifyReplace,
  "notificationclick-focus-or-open": runBreakNotificationclickFocusOrOpen,
  "needs-input-delivers": runBreakNeedsInputDelivers,
};

const PROBES = {};

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  await assertNoLiveService();

  const argv = process.argv.slice(2);
  const checkName = readFlag(argv, "--check");
  if (checkName != null && !Object.hasOwn(CHECKS, checkName)) {
    console.error(
      `unknown check "${checkName}", valid: ${Object.keys(CHECKS).join(", ")}`,
    );
    process.exit(1);
  }
  const breakName = readFlag(argv, "--break");
  if (breakName != null && !Object.hasOwn(BREAKS, breakName)) {
    console.error(
      `unknown break "${breakName}", valid: ${Object.keys(BREAKS).join(", ")}`,
    );
    process.exit(1);
  }
  const probeName = readFlag(argv, "--probe");
  if (probeName != null && !Object.hasOwn(PROBES, probeName)) {
    console.error(
      `unknown probe "${probeName}", valid: ${Object.keys(PROBES).join(", ")}`,
    );
    process.exit(1);
  }
  if (Object.keys(CHECKS).length === 0) {
    console.error(
      "panel-110: refusing to exit 0, CHECKS is empty (would read as a vacuous pass)",
    );
    process.exit(1);
  }

  if (probeName != null) {
    await PROBES[probeName]();
    process.exit(0);
  }

  if (breakName != null) {
    const result = await BREAKS[breakName]();
    console.log(
      `\n--break ${breakName} summary: tripFired=${result.tripFired} restoreClean=${result.restoreClean}`,
    );
    if (!result.tripFired) {
      console.log(
        `FAIL (self-check): the trip leg did NOT report the expected violation for "${breakName}", the check is a dead instrument.`,
      );
      process.exit(1);
    }
    if (!result.restoreClean) {
      console.log(
        `FAIL (self-check): the restore leg for "${breakName}" still reports a violation after restoring the captured original value.`,
      );
      process.exit(1);
    }
    console.log(
      `PASS (--break ${breakName} self-check): trip leg correctly reported the violation, restore leg re-passed clean.`,
    );
    process.exit(0);
  }

  const violations = [];
  const names = checkName != null ? [checkName] : Object.keys(CHECKS);
  for (const n of names) {
    console.log(`\n=== running check: ${n} ===`);
    const before = violations.length;
    try {
      await CHECKS[n](violations);
    } catch (err) {
      violations.push(
        `${n}: run failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
      );
    }
    const added = violations.length - before;
    console.log(
      added === 0 ? `PASS (${n})` : `FAIL (${n}): ${added} violation(s)`,
    );
  }

  if (violations.length > 0) {
    console.log(`\nFAIL: ${violations.length} violation(s)`);
    for (const v of violations) console.log(`  ${v}`);
    process.exit(1);
  }

  console.log("\nPASS");
  process.exit(0);
}

main().catch((err) => {
  console.error(`panel-110 failed: ${err.stack ?? err.message}`);
  process.exit(1);
});
