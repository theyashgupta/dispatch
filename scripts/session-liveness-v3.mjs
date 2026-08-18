/**
 * Real-tmux / real-ttyd liveness instrument (Phase 91, HOOK-01, dev/ops tooling, NOT test code):
 * imports no test framework, asserts nothing via an assertion library, lives outside src/ — the
 * same category as check-invariants.mjs, migration-diff-v3.mjs, and redaction-capture-v3.mjs. The
 * ROADMAP forbids settling this phase's liveness criteria from store records alone ("a store
 * record alone would make every liveness criterion unfalsifiable, which is precisely the
 * dead-instrument failure v2.9 documented nine times"), so this harness stands up REAL tmux
 * sessions running a trivial long-lived shell loop (never `claude`, no worktrees, no repo
 * mutation) with a REAL ttyd each against a sandboxed `HOME`, seeds one card owning them as
 * `Session` records, boots the production server against that sandbox, and exercises the real
 * hook route over loopback HTTP. Two fixture SHAPES exist: the two-session fixture every
 * cross-session check needs, and the one-session fixture the N=1 parity leg needs — see
 * {@link TWO_SESSION_FIXTURE} and {@link SINGLE_SESSION_FIXTURE}.
 *
 * SAFETY IS THIS FILE'S FIRST-ORDER CONCERN. `adoptAndSweep` (`ttyd.ts`) fingerprints ttyd by ARGV
 * SHAPE — `ttyd` + `tmux attach`, the `DISPATCH_TTYD_REVISION_6` retained key, or the
 * `-b /sessions/<sessionId>/terminal` base path — and NEVER by tmux session name, so a harness ttyd
 * is fingerprint-indistinguishable from the user's live service's ttyd regardless of how
 * distinctly this harness names its own tmux sessions. {@link assertNoLiveService} is therefore
 * the ONLY real protection: it fails closed (throws, never degrades) whenever anything answers on
 * the user's live `:4700`, and it is re-run at the top of every single `--check` invocation, not
 * once per process — every break-proving re-run in this phase's Task 3 gets its own fresh assert.
 * Tmux session names still carry the `dsp91h-<pid>-` prefix (protects the tmux layer only, per
 * 91-VALIDATION.md's amended Safety section) and every spawned process is torn down in a `finally`
 * whose own success is THEN VERIFIED with `lsof`/`tmux list-sessions` — a leaked ttyd is reported
 * as a violation, never silently swallowed.
 *
 * KNOWN, ACCEPTED SIDE EFFECT (T-90-19, same acceptance as migration-diff-v3.mjs's own header):
 * booting the sandbox server runs `reconcileSessions()`, which sweeps `dsp`-fingerprinted ttyd
 * processes MACHINE-WIDE via `adoptAndSweep` — not scoped by HOME. `assertNoLiveService()` is what
 * makes this acceptable: it refuses to run at all while the user's real service could have live
 * ttyd of its own to lose. That refusal is FAIL-CLOSED BY DESIGN and has no override flag: a
 * `--check` that cannot run while the user's service is up is a check pending a window, never a
 * check to be talked past.
 *
 * SANDBOX SAFETY IS SCOPED TO STATE ON DISK PLUS THE `:4700` PROBE, NOT TO EVERY PROCESS ON THE
 * MACHINE. `assertSandboxSafe` enforces the database and the port; `assertNoLiveService` covers
 * the one machine-wide process hazard this harness introduces. Within that scope the guarantee is
 * absolute: every sandbox HOME lives under `os.tmpdir()` with a `dispatch-session-liveness-v3-`
 * basename, the running fixture's port is asserted to never be 4700, and the real `~/.dispatch/board.db`'s
 * mtime and size are recorded before this script does anything and again after every `--check` run
 * — a mismatch is a loud non-zero-exit failure, not a warning. This harness never writes to
 * `~/.dispatch/`.
 *
 * The frontend dev-server proxy is never used: it hardcodes its dev-mode targets to the user's
 * real, live dispatch port. This harness only ever boots the production build
 * (`dist/server/bootstrap/index.js`), and COMPILES it first ({@link assertBuilt}) so what it proves
 * is always a property of the current `src/` — a `dist` left over from an earlier commit otherwise
 * reports today's fixes as absent, blaming source that already reads correctly.
 *
 * Usage:
 *   node scripts/session-liveness-v3.mjs --check safety            the fixture-standup/teardown proof
 *   node scripts/session-liveness-v3.mjs --check hook-attribution  the per-session hook POST proof
 *   node scripts/session-liveness-v3.mjs --check liveness          WATCH-01/C2: kill one of two real
 *                                                                   tmux sessions, wait out the real
 *                                                                   3-strike detector, both directions
 *   node scripts/session-liveness-v3.mjs --check reconcile         RECON-01/C3: a live sibling's ttyd
 *                                                                   survives a real backend restart on
 *                                                                   its own port, held by the same PID
 *   node scripts/session-liveness-v3.mjs --check attention          UI-02/C5: any session's NEEDS_INPUT
 *                                                                   marker moves the card, a SIBLING's
 *                                                                   reply cannot clear it, the firing
 *                                                                   session's own reply can
 *   node scripts/session-liveness-v3.mjs --check attention-dead-sibling
 *                                                                   CR-01: the same gate RELEASES once
 *                                                                   the marker-holding sibling is really
 *                                                                   dead — otherwise needs_input is a
 *                                                                   one-way latch nothing can clear
 *   node scripts/session-liveness-v3.mjs --check single-session    the N=1 parity leg: marker
 *                                                                   routing, flip-back, session-lost
 *                                                                   detection and the unseen-activity
 *                                                                   dot on a card owning EXACTLY ONE
 *                                                                   session — the only mode that does
 *                                                                   not seed a sibling
 *   node scripts/session-liveness-v3.mjs --check proxy-addressing  PROXY-01/C1 (partial, active
 *                                                                   session only): a real ttyd wire-
 *                                                                   protocol read through the reverse
 *                                                                   proxy returns the pane's own
 *                                                                   marker text — plan 02 extends this
 *                                                                   to the two-sibling isolation claim
 *   node scripts/session-liveness-v3.mjs --check orphan-sweep      TERM-05/C6: a REAL ttyd carrying
 *                                                                   the pre-92 fingerprint is swept on
 *                                                                   the next boot, while the fixture's
 *                                                                   own two current-revision ttyd are
 *                                                                   spared and still serve pane content
 *   node scripts/session-liveness-v3.mjs --check switch-sockets    PROXY-01/C2: a real switch's OLD
 *                                                                   dispatch-to-ttyd socket, held by
 *                                                                   the sandbox server's own pid,
 *                                                                   polls to zero — never counted as
 *                                                                   a single instant read
 *   node scripts/session-liveness-v3.mjs --check switch-atomicity  SESS-03/C3: 50+ concurrent switch
 *                                                                   and read requests plus a switch
 *                                                                   racing a real tmux kill, neither
 *                                                                   interleaving ever strands the
 *                                                                   active pointer or tears the wire
 *                                                                   projection
 *   node scripts/session-liveness-v3.mjs --check cleanup-fixture   Phase 93 Wave 0: each fixture
 *                                                                   session owns a REAL, git-
 *                                                                   registered worktree in a real
 *                                                                   throwaway repo under the sandbox
 *                                                                   HOME, proven by `git worktree
 *                                                                   list`, never by `existsSync`
 *   node scripts/session-liveness-v3.mjs --check cleanup-isolation Phase 93 criteria 1/5: cleaning
 *                                                                   ONE session (via the real
 *                                                                   scheduler) removes only ITS
 *                                                                   worktree/workspace/tmux/ttyd —
 *                                                                   the sibling proven ANSWERABLE
 *                                                                   (a fresh prompt typed into its
 *                                                                   real pane, read back through the
 *                                                                   proxy), branches surviving, and
 *                                                                   a cleaned session's ttyd never
 *                                                                   re-adopted after a restart
 *   node scripts/session-liveness-v3.mjs --check cleanup-refusal   Phase 93 criterion 3: BOTH
 *                                                                   directions of the dirty-worktree
 *                                                                   refusal in one fixture pair — a
 *                                                                   dirty sibling never blocks a
 *                                                                   clean session's teardown, a clean
 *                                                                   sibling never causes a dirty
 *                                                                   session's teardown, the refusal
 *                                                                   names its session and repo on the
 *                                                                   record and the wire, and a single
 *                                                                   fan-out click proves the partial
 *                                                                   outcome (one torn down, one
 *                                                                   blocked) coexist
 *   node scripts/session-liveness-v3.mjs --check cleanup-branches  Phase 93 criterion 4: all FIVE
 *                                                                   terminal branches of
 *                                                                   cleanupWorkspace, enumerated
 *                                                                   from cleanup.ts source (never
 *                                                                   hardcoded), driven for real,
 *                                                                   the persisted pointer read
 *                                                                   after each — both promotion
 *                                                                   cases (active-with-sibling,
 *                                                                   last-session), the scheduler's
 *                                                                   own left-Done and
 *                                                                   double-dispatch guards, and the
 *                                                                   isStarting leg's honest
 *                                                                   NOT-DRIVABLE finding
 *   node scripts/session-liveness-v3.mjs --check cleanup-schedule-restart
 *                                                                   Phase 93 criterion 2: a genuine
 *                                                                   Done arrival stamps EVERY
 *                                                                   session, then two sessions
 *                                                                   seeded with DIFFERENT due times
 *                                                                   are carried across a REAL
 *                                                                   backend restart between the
 *                                                                   schedule and the earlier due
 *                                                                   time — the early one fires, the
 *                                                                   later one and its own schedule
 *                                                                   survive untouched and are proven
 *                                                                   live by firing it too, with a
 *                                                                   permanent guard against the
 *                                                                   same-due-time dead instrument
 *   node scripts/session-liveness-v3.mjs --check all               every check, its own fresh fixture(s)
 *
 * `liveness` and `reconcile` each run MORE THAN ONE fixture cycle within a single invocation — a
 * rebuilt fixture per kill direction for `liveness`, a live-restart stage plus a fresh
 * dead-session-before-restart stage for `reconcile` — because each needs to start from BOTH
 * sessions live, independent of any prior direction/stage's own mutation. {@link withFixture} is
 * the shared per-cycle lifecycle every check (old and new) now goes through.
 *
 * Exit codes: 0 all checks PASS. 1 a safety-envelope refusal, a setup/build error, a check
 * violation, a teardown-verification failure, or the live board.db changing.
 */
import { spawn, execFile, execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir, homedir } from "node:os";
import { basename, delimiter, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { randomBytes, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const execFileP = promisify(execFile);

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST_ENTRY = join(REPO_ROOT, "dist", "server", "bootstrap", "index.js");

/**
 * Production's own worktree adapter and path rule, loaded from `dist` (never re-derived) so
 * {@link WORKTREE_FIXTURE} proves something about the shipped code path rather than about a
 * hand-rolled `git worktree add` shell-out. Dynamically `import()`ed (see {@link loadGitAdapter} /
 * {@link loadWorkspacePathsAdapter}) rather than a static top-level import: a static import
 * resolves at module-parse time, before {@link assertBuilt} ever runs, so it could silently load a
 * stale `dist` left over from an earlier commit — the exact staleness class {@link assertBuilt}'s
 * own JSDoc says this harness must make structurally impossible.
 */
const DIST_GIT_ADAPTER = join(
  REPO_ROOT,
  "dist",
  "server",
  "adapters",
  "git.js",
);
const DIST_WORKSPACE_PATHS = join(
  REPO_ROOT,
  "dist",
  "server",
  "services",
  "domain",
  "workspace-paths.js",
);

/**
 * The package script {@link assertBuilt} shells out to. Named here rather than spelled as a raw
 * `tsc -p …` invocation so the harness can never compile the server differently from the way the
 * project does — one build command, not two literals that can drift apart.
 */
const BUILD_SERVER_SCRIPT = "build:server";

const SANDBOX_PORT = 47862;

/**
 * The single-session fixture's own sandbox port, deliberately distinct from {@link SANDBOX_PORT}.
 * Two fixture shapes that never share a port cannot block or be mistaken for each other:
 * {@link assertPreflightClean} refuses to start when the fixture's OWN port is already bound, so a
 * two-session server a prior run leaked can never silently pass for this fixture's own server, nor
 * stop this fixture from running.
 */
const SINGLE_SESSION_SANDBOX_PORT = 47863;

const SANDBOX_PREFIX = "dispatch-session-liveness-v3-";

/**
 * Sole occurrence of the literal `.dispatch` config-directory name in this file — reused both for
 * the sandbox home's own `.dispatch` directory ({@link makeSandboxHome}) and, read-only, to locate
 * the REAL `~/.dispatch/board.db` this harness's before/after mtime+size assertion protects
 * ({@link statRealBoardDb}). A single named constant instead of two independent string literals
 * keeps that reuse visible in one place rather than scattering the config-directory name.
 */
const DISPATCH_DIR_NAME = ".dispatch";

/**
 * Namespaces this run's tmux session names distinctly from the user's own `dsp-*` sessions and from
 * any prior run's names (PID-suffixed). Protects the tmux layer ONLY — see the file header: ttyd's
 * own re-adoption/sweep fingerprint never reads a tmux session name, so this prefix does nothing to
 * make this harness's ttyd distinguishable from the live service's; {@link assertNoLiveService} is
 * the sole real protection at that layer.
 */
const TMUX_PREFIX = `dsp91h-${process.pid}-`;

/**
 * The single-session fixture's own tmux namespace, distinct from {@link TMUX_PREFIX} for the same
 * reason {@link SINGLE_SESSION_SANDBOX_PORT} is distinct from {@link SANDBOX_PORT}:
 * {@link assertPreflightClean} and {@link tearDownFixture} both filter `tmux list-sessions` by the
 * RUNNING fixture's own prefix, so a leak left by one fixture shape is never attributed to — or
 * cleaned up as — the other's. Carried over verbatim from the scratch single-session script this
 * mode replaces.
 */
const SINGLE_SESSION_TMUX_PREFIX = `dsp91sp-${process.pid}-`;

/**
 * The exact re-adoption fingerprint key `spawnTtyd` (`ttyd.ts`) emits via `-t
 * DISPATCH_TTYD_REVISION_6=1` — without it, boot-time `adoptAndSweep` cannot mark this harness's
 * own ttyd as `compatible` and would sweep it as an unrecognized orphan instead of adopting it.
 * Bumped 5 -> 6 in lockstep with `ttyd.ts`'s own `TTYD_RUNTIME_REVISION` (PROXY-01): a harness
 * still asserting `_5` would spawn a ttyd its OWN sandbox boot's `reconcileSessions()` sweeps as
 * incompatible before any check ever runs against it.
 * @see docs/ARCHITECTURE.md#terminal-ttyd
 */
const TTYD_REVISION_RETAINED_KEY = "DISPATCH_TTYD_REVISION_6";

const FAKE_LINEAR_API_KEY = "session-liveness-v3-harness-fake-key-never-real";

const FIXTURE_CARD_ID = "shl-card";

/**
 * Which `built` field each session key publishes itself under, so {@link standUpFixture} can build
 * a fixture from a key LIST while every check keeps reading the same `built.sessionA` /
 * `built.sessionB` names it always read. A fixture whose `sessionKeys` omits `b` leaves
 * `built.sessionB` null, which is the point: a check written against a sibling cannot silently run
 * on a fixture that has none.
 */
const SESSION_FIELD_BY_KEY = { a: "sessionA", b: "sessionB" };

const WORKSPACE_SUFFIX_BY_SESSION_KEY = { a: "SHL-1", b: "SHL-1-sibling" };

/**
 * A fixture PROFILE is the whole of what differs between this harness's two fixture shapes: which
 * sandbox port it boots on, which tmux namespace it owns, and — the load-bearing one —
 * `sessionKeys`, whose LENGTH IS the fixture's session count.
 *
 * `["a", "b"]` is what every check except `single-session` has always used. `["a"]` builds a card
 * owning exactly ONE session record, which no two-session fixture can approximate rather than
 * merely resemble: `redactCard` emits `sessionCount` only at >= 2, and every cross-session gate in
 * the store has a sibling to bind against, so N=1 is a structurally different subject rather than
 * the same subject with one participant idle.
 */
const TWO_SESSION_FIXTURE = {
  port: SANDBOX_PORT,
  tmuxPrefix: TMUX_PREFIX,
  sessionKeys: ["a", "b"],
};

const SINGLE_SESSION_FIXTURE = {
  port: SINGLE_SESSION_SANDBOX_PORT,
  tmuxPrefix: SINGLE_SESSION_TMUX_PREFIX,
  sessionKeys: ["a"],
};

const WORKTREE_SANDBOX_PORT = 47865;

const WORKTREE_TMUX_PREFIX = `dsp93h-${process.pid}-`;

/**
 * The first fixture profile whose sessions own a REAL git worktree, registered in a real throwaway
 * repo under the sandbox HOME (Phase 93, Wave 0). `worktrees: true` is the flag
 * {@link standUpFixture} and {@link tearDownFixture} branch on, so every existing profile above —
 * none of which sets it — keeps its current, worktree-free behaviour byte-for-byte.
 */
const WORKTREE_FIXTURE = {
  port: WORKTREE_SANDBOX_PORT,
  tmuxPrefix: WORKTREE_TMUX_PREFIX,
  sessionKeys: ["a", "b"],
  worktrees: true,
};

const SECOND_SESSION_SANDBOX_PORT = 47866;

/**
 * A real ticket identifier the actual start saga will consume (`IDENTIFIER_RE`-shaped), rather
 * than the `SHL-1` placeholder every other fixture seeds — {@link standUpRealSagaFixture}'s
 * session 1 is named `dsp-${SECOND_SESSION_IDENTIFIER}`, so this PID-suffixed value doubles as
 * this fixture's own tmux namespace: `dsp-<identifier>` is a genuine PREFIX of the real saga's own
 * `dsp-<identifier>-2`, the relationship 94-VALIDATION.md's tmux prefix-match trap needs to be
 * real rather than simulated by two independently-prefixed harness names.
 */
const SECOND_SESSION_IDENTIFIER = `ZZ94${process.pid}-1`;

/**
 * The first fixture profile whose session 1 is stood up with the PRODUCT'S OWN naming
 * (`dsp-<identifier>`, not a `tmuxPrefix`-derived synthetic name) and whose session 2 is created
 * by driving the REAL start saga end to end (Plan 94-05) — `realSaga: true` is the flag
 * {@link standUpFixture} and {@link tearDownFixture} branch on to reach
 * {@link standUpRealSagaFixture} / {@link tearDownRealSagaFixture}, leaving every other profile's
 * behaviour byte-for-byte unchanged. `tmuxPrefix` here is `dsp-<identifier>` itself (not a
 * separate namespace token) so {@link assertPreflightClean}'s generic prefix filter also catches a
 * leaked `dsp-<identifier>-2` sibling from a prior failed run without any change to that function.
 */
const SECOND_SESSION_FIXTURE = {
  port: SECOND_SESSION_SANDBOX_PORT,
  tmuxPrefix: `dsp-${SECOND_SESSION_IDENTIFIER}`,
  sessionKeys: ["a"],
  identifier: SECOND_SESSION_IDENTIFIER,
  realSaga: true,
};

/**
 * Ceiling for {@link waitForSagaSettled}'s poll of the real start saga: the stub `claude`'s own
 * REPL-ready line prints in milliseconds, but `git worktree add` on the throwaway repo plus
 * `sendKickoff`'s real 500ms paste-settle sleep are genuine wall-clock costs this ceiling must
 * clear with room to spare.
 */
const SECOND_SESSION_SAGA_TIMEOUT_MS = 20_000;

/**
 * Ceiling for {@link checkSecondStartRollbackDirection2}'s wait on a forced restart failure.
 * Deliberately longer than `steps.ts`'s own `READINESS_TIMEOUT_MS` (30s): once the prefix-match
 * silent-success trap (this direction's own doc comment) rules out every faster failure path, the
 * only remaining route to `startClaude.undo` is `awaitReplReady`'s own hardcoded 30s deadline, so
 * this ceiling must comfortably outlive it rather than race it.
 */
const RESTART_REPL_TIMEOUT_SETTLE_MS = 35_000;

const POLL_INTERVAL_MS = 100;
const READY_TIMEOUT_MS = 30_000;
const KILL_TIMEOUT_MS = 5_000;
const PORT_PARSE_TIMEOUT_MS = 10_000;
const LISTEN_POLL_TIMEOUT_MS = 10_000;

/**
 * Bound for {@link readPaneThroughProxy}'s wait for the marker to appear in the accumulated pane
 * text. Generous relative to a loopback WS round trip so a slow CI box never produces a false
 * content violation; a genuine routing break (connection refused, upgrade rejected) resolves the
 * promise immediately via the `close`/`error` listener and never waits out this ceiling.
 */
const PROXY_READ_TIMEOUT_MS = 10_000;

/**
 * Bound for {@link checkCleanupIsolationScheduler}'s poll for the real cleanup scheduler to
 * dispatch a past-due session's teardown, and for {@link checkCleanupIsolationFanout}'s poll for
 * the manual fan-out route to remove every session on the card. Generous relative to the trivial
 * throwaway repo's own git subprocess latency (worktree remove/prune on a one-file repo is
 * sub-second) so a slow CI box never produces a false "the scheduler never fired" violation.
 */
const CLEANUP_ISOLATION_SETTLE_TIMEOUT_MS = 20_000;

/**
 * Bound for {@link probeSubprotocolAcceptance}'s two one-shot connection attempts (`92-RESEARCH.md`
 * assumption A2). Short relative to {@link PROXY_READ_TIMEOUT_MS} because this probe only needs to
 * observe whether the WS upgrade itself completes, never a pane read.
 */
const SUBPROTOCOL_PROBE_TIMEOUT_MS = 5_000;

/**
 * MEASURED, not asserted, budget for the wall-clock gap between a proxied client WS closing and
 * `lsof -sTCP:ESTABLISHED` reporting the dispatch-server-to-ttyd upstream socket gone
 * (`92-RESEARCH.md` `## 3` Open Question 2 — the teardown wiring is event-driven with no timer, but
 * the wall-clock bound was explicitly left unmeasured until this constant was derived). Measured on
 * this machine, 2026-08-18, against a real proxied WS opened with the `"tty"` sub-protocol and
 * closed client-side, polling {@link countEstablishedToPort} every 10ms: five runs on the standing
 * two-session fixture, each preceded by an assertion that the pre-close count reads exactly 1 (a 0
 * reading there would mean the instrument itself is blind, per `92-VALIDATION.md`'s Dead-Instrument
 * Register) — raw readings in ms: `[14, 11, 12, 13, 11]`, max 14ms. Set to 20x that max, floored at
 * 2000ms since the raw max is itself in the tens-of-milliseconds range this file's own header
 * predicted. Plan 92-05 consumes this as criterion 2's poll ceiling, where exhausting it is a
 * FAILURE and never a retry — never shorten it without re-measuring on the machine the check runs on.
 */
const SOCKET_TEARDOWN_POLL_MS = 2000;

/**
 * The liveness sub-check's own poll budget (WATCH-01/C2): the 3-strike detector is
 * `captureFailures >= 3` (`watcher.ts:146`) on a self-rescheduling 2000 ms tick
 * (`watcher.ts:321`), so three consecutive failures trip roughly 4-6s after a real kill, with
 * worst-case tick-boundary jitter adding up to one more full cycle — 20s is a generous ceiling,
 * never a target. {@link LIVENESS_MIN_ELAPSED_MS} is the floor a genuine detector-driven
 * transition cannot beat: a transition observed faster than 4s did not come from the real
 * 2000 ms tick and 3-strike threshold, which this harness must NEVER shorten (the interval is
 * itself part of what the criterion verifies).
 */
const LIVENESS_POLL_INTERVAL_MS = 500;
const LIVENESS_POLL_TIMEOUT_MS = 20_000;
const LIVENESS_MIN_ELAPSED_MS = 4_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fail-closed pre-flight for WR-08 (91-VALIDATION.md's amended Safety section, T-91-20): the
 * machine-wide ttyd sweep this harness's own boot triggers cannot distinguish its ttyd from the
 * user's live service's — argv fingerprinting never reads a tmux session name. A `fetch` that
 * resolves means something answered on the user's real port and this run must refuse outright; only
 * a REJECTED fetch (ECONNREFUSED, the live service confirmed stopped) is the safe path, and the
 * WR-08 error is re-thrown from inside the catch so it is never swallowed. Reused verbatim from
 * `density-91.mjs`'s own WR-08 pattern (91-01-SUMMARY.md) — the load-bearing precedent every later
 * Phase 91 instrument copies — and re-run at the top of every `--check` invocation, not once per
 * process.
 */
async function assertNoLiveService() {
  try {
    const res = await fetch("http://127.0.0.1:4700/api/board");
    await res.body?.cancel().catch(() => {});
    throw new Error(
      "WR-08: a live dispatch service answered on :4700 — refusing to start real tmux/ttyd " +
        "processes while the user's real service is up. The machine-wide ttyd sweep this " +
        "harness's own boot triggers cannot distinguish this harness's ttyd from the live " +
        "service's ttyd by tmux session name alone (adoptAndSweep fingerprints on argv shape).",
    );
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("WR-08")) throw err;
  }
}

/**
 * The structural guarantee behind "never touches the user's real board.db or port 4700" (the
 * `migration-diff-v3.mjs` precedent, verbatim four checks): port, real-HOME identity, tmpdir
 * containment, basename prefix. Throws (never silently degrades) if any check fails. PROCESS state
 * is deliberately outside this function's scope — {@link assertNoLiveService} covers that.
 * @remarks `port` is the RUNNING fixture profile's own port rather than a module constant, so the
 * never-4700 half of this guard covers every fixture shape this harness can build — a second
 * fixture profile added later cannot acquire a port that no guard ever reads.
 */
function assertSandboxSafe(home, port) {
  if (port === 4700) {
    throw new Error(
      `sandbox port must never equal 4700 — that is the user's live dispatch instance (got ${port}).`,
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

/**
 * Resolve `target` to a real, symlink-free path even when it (or several levels of its parents)
 * does not exist yet — a worktree path about to be created has nothing for `realpathSync` to
 * resolve directly. Walks UP from `target` to the nearest ancestor that already exists (this
 * always terminates: {@link makeSandboxHome} already created the sandbox HOME itself before any
 * fixture path under it is asserted), `realpathSync`s that ancestor, then rejoins the non-existent
 * suffix components onto the resolved result. A naive `path.resolve` fallback on a non-existent
 * path is NOT enough on macOS: `os.tmpdir()` resolves through a `/private` symlink, so an
 * as-yet-uncreated path built by joining the UNRESOLVED `tmpdir()` root would compare unequal to
 * the resolved tmpdir root {@link assertUnderTmpdir} checks against — the exact trap 93-RESEARCH.md
 * names for this harness.
 */
function realpathOrNearestExistingAncestor(target) {
  let candidate = resolve(target);
  const suffix = [];
  while (!existsSync(candidate)) {
    const parent = dirname(candidate);
    if (parent === candidate) {
      // reached the filesystem root without finding anything real — let the
      // caller's tmpdir-prefix check fail loudly rather than loop forever.
      break;
    }
    suffix.unshift(basename(candidate));
    candidate = parent;
  }
  const real = realpathSync(candidate);
  return suffix.length > 0 ? join(real, ...suffix) : real;
}

/**
 * Fail-closed containment guard for the FIRST harness in this repo whose subject is DELETION
 * (Phase 93): a fixture worktree, throwaway repo, or workspace directory that escapes the real
 * `os.tmpdir()` would let a teardown bug destroy the user's actual repos, a materially worse
 * failure than anything an earlier phase's harness could cause. `realpathSync` the real tmpdir root
 * on every call rather than caching it — macOS resolves `/tmp`/`/var` through a `/private` symlink,
 * so a raw string prefix compare is unreliable, and re-resolving is cheap. `target` is resolved via
 * {@link realpathOrNearestExistingAncestor}, which handles both the already-exists case (matching
 * how git records worktree paths, per {@link worktreeRegistered}'s own comment in `git.ts`) and the
 * not-yet-created case (a worktree or workspace path about to be created) without falling back to
 * an unresolved `path.resolve`. THROWS — never returns a boolean, never logs-and-continues —
 * because a containment guard a caller could ignore is not a guard; every destructive call site in
 * this file invokes it immediately before the operation it protects, not once at fixture setup.
 */
function assertUnderTmpdir(target, label) {
  const realTmp = realpathSync(tmpdir());
  const resolved = realpathOrNearestExistingAncestor(target);
  if (resolved !== realTmp && !resolved.startsWith(realTmp + sep)) {
    throw new Error(
      `containment guard: refusing to touch ${label} (${target}) — resolved path ${resolved} is not under the real tmpdir ${realTmp}`,
    );
  }
}

/**
 * Compute, safety-check, and materialize a fresh sandbox `HOME` with a config carrying only a
 * hardcoded, obviously-fake Linear key — this harness seeds cards directly via `node:sqlite`, so it
 * never reads or needs a real key. No process is spawned by this call.
 */
function makeSandboxHome(label, port) {
  const home = join(tmpdir(), `${SANDBOX_PREFIX}${label}-${process.pid}`);
  assertSandboxSafe(home, port);
  const dispatchDir = join(home, DISPATCH_DIR_NAME);
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

/**
 * Boot the harness's own server against `home`. Only ever spawns the production build — the Vite
 * dev proxy hardcodes its dev-mode targets to the user's real, live dispatch port. Stdout/stderr are
 * piped and captured into the returned `logLines` array (never printed unless a check explicitly
 * inspects them) so a check that needs to confirm a specific server-side log line — e.g. the
 * orphan-token refusal a hook-attribution break proves — has something to grep without re-plumbing
 * stdio per call site. SECURITY: this harness's server never logs token values (matches the app's
 * own hook-tokens.ts contract), so capturing full output is safe.
 * @remarks The build precondition is re-asserted here through {@link assertBuilt} rather than by a
 * local `existsSync` copy, so the staleness half can never be enforced at only some of the places
 * that spawn `dist` — this is the function every boot in the file funnels through.
 * @remarks Spawns `realpathSync(DIST_ENTRY)`, not the raw path (Phase 93 macOS trap): `dist`'s own
 * `main()` guard compares `import.meta.url` against `pathToFileURL(process.argv[1])`, and
 * `os.tmpdir()` resolves through a `/private` symlink on macOS, so a server booted from an
 * unresolved tmpdir-rooted path would silently exit 0 with no output rather than start. Defensive
 * here (`DIST_ENTRY` is inside the repo, not under tmpdir), but load-bearing for any check that ever
 * boots from a tmpdir worktree.
 * @remarks `opts.pathPrefix` (Plan 94-05) is prepended onto the spawned child's `PATH`, so
 * `resolveBinaryPath("claude")` (`resolve-binary.ts`, a bare `which claude`) resolves a stub
 * binary planted earlier on that prefix before it ever reaches a real `claude` install. Every
 * pre-existing call site passes no `opts`, so `PATH` is inherited unchanged for them.
 */
function bootServer(home, opts = {}) {
  assertBuilt();
  const env = { ...process.env, HOME: home, NODE_ENV: "production" };
  if (opts.pathPrefix) {
    env.PATH = `${opts.pathPrefix}${delimiter}${env.PATH ?? ""}`;
  }
  const child = spawn("node", [realpathSync(DIST_ENTRY)], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const logLines = [];
  const capture = (buf) => {
    for (const line of buf.toString().split("\n")) {
      if (line.length > 0) logLines.push(line);
    }
  };
  child.stdout?.on("data", capture);
  child.stderr?.on("data", capture);
  return { child, logLines };
}

/** `tmux list-sessions -F '#{session_name}'`, tolerant of a dead/absent tmux server (empty list). */
async function tmuxListSessionNames() {
  try {
    const { stdout } = await execFileP("tmux", [
      "list-sessions",
      "-F",
      "#{session_name}",
    ]);
    return stdout
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * `tmux new-session -d -s <name> -c <cwd>` running a trivial long-lived shell loop — never
 * `claude`, no worktrees, no repo mutation (91-VALIDATION.md's Safety section).
 */
async function tmuxNewSession(name, cwd) {
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

/** `tmux kill-session -t <name>`, tolerant of an already-gone session. */
async function tmuxKillSession(name) {
  try {
    await execFileP("tmux", ["kill-session", "-t", name]);
  } catch {
    // already gone — idempotent teardown
  }
}

/**
 * `tmux kill-session -t =<name>` — the `=` EXACT-MATCH form, tolerant of an already-gone session.
 * Required whenever a target name can be a tmux PREFIX of a live sibling (`dsp-<identifier>`
 * beside `dsp-<identifier>-2`): the bare form in {@link tmuxKillSession} prefix-matches on tmux
 * 3.6a when no exact match exists, so killing session 1 by its bare name after session 2 already
 * exists is not guaranteed to kill session 1 specifically. Never used for `send-keys`/
 * `capture-pane`, which report "can't find pane" under `=` on this tmux version.
 */
async function tmuxKillSessionExact(name) {
  try {
    await execFileP("tmux", ["kill-session", "-t", `=${name}`]);
  } catch {
    // already gone — idempotent teardown
  }
}

/**
 * Write distinguishable text into a real tmux pane via the two-step literal-then-Enter form the
 * project's own kickoff-prompt delivery already relies on (`92-RESEARCH.md` `## 6`): a literal
 * `send-keys -l` carrying the text, then a SEPARATE bare `Enter` key. Combining the two into one
 * `send-keys` call can fire on partial text; this harness never does that for a real `claude`
 * prompt and must not do it here either. `home` is accepted for interface symmetry with
 * {@link tmuxNewSession} (the session already exists by the time a marker is written, so no `-c`
 * working-directory flag applies here).
 */
async function writePaneMarker(tmuxName, home, text) {
  await execFileP("tmux", [
    "send-keys",
    "-t",
    tmuxName,
    "-l",
    "--",
    `echo ${text}`,
  ]);
  await execFileP("tmux", ["send-keys", "-t", tmuxName, "Enter"]);
}

/** `lsof -nP -iTCP:<port> -sTCP:LISTEN` existence check, tolerant of lsof's non-zero exit on no match. */
async function isPortListening(port) {
  try {
    await execFileP("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"]);
    return true;
  } catch {
    return false;
  }
}

/** The repo's `lsof -Fpn` port→PID resolver (`ttyd.ts#pidsListeningOnPorts`), single-port form. */
async function pidsListeningOnPort(port) {
  try {
    const { stdout } = await execFileP("lsof", [
      "-nP",
      `-iTCP:${port}`,
      "-sTCP:LISTEN",
      "-Fpn",
    ]);
    const pids = [];
    for (const line of stdout.split("\n")) {
      if (line.startsWith("p")) pids.push(Number(line.slice(1)));
    }
    return pids;
  } catch {
    return [];
  }
}

/**
 * Count `ESTABLISHED` TCP connections to `port` owned by `pid`, plus the parsed local
 * (dispatch-side) socket endpoints — the primitive `92-RESEARCH.md` `## 3` establishes as the ONLY
 * sound way to observe the dispatch-server-to-ttyd leg: that socket is held by the SANDBOX SERVER
 * process (`net.connect` inside `upgradeForward`), never by any client, so scoping to `pid` is what
 * keeps this from reading a constant regardless of behaviour (the dead-instrument hazard `92-
 * VALIDATION.md`'s register names first). `-sTCP:ESTABLISHED` is the connected-side counterpart to
 * {@link isPortListening}'s `-sTCP:LISTEN`, same tool and the same `-Fpn` parse shape as
 * {@link pidsListeningOnPort}, tolerant of lsof's non-zero exit on no match the same way.
 */
async function countEstablishedToPort(port, pid) {
  try {
    const { stdout } = await execFileP("lsof", [
      "-nP",
      `-iTCP:${port}`,
      "-sTCP:ESTABLISHED",
      "-Fpn",
    ]);
    let currentPid = null;
    let count = 0;
    const endpoints = [];
    for (const line of stdout.split("\n")) {
      if (line.startsWith("p")) {
        currentPid = Number(line.slice(1));
      } else if (line.startsWith("n") && currentPid === pid) {
        count += 1;
        endpoints.push(line.slice(1));
      }
    }
    return { count, endpoints };
  } catch {
    return { count: 0, endpoints: [] };
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

/** True while `pid` still answers a signal-0 existence probe (ESRCH means it is gone). */
function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Poll {@link pidAlive} until `pid` is gone or `timeoutMs` elapses. A timeout resolves `false` —
 * the caller decides whether that is a violation, this primitive only measures.
 */
async function waitForPidGone(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!pidAlive(pid)) return true;
    await sleep(POLL_INTERVAL_MS);
  }
  return false;
}

/**
 * Full `ps -p <pid> -o pid=,command=` line for a diagnostic — the exact surviving-process evidence
 * a sweep-direction violation must name, not just its bare pid. A pid `ps` can no longer find by
 * the time this reads it is itself informative (a lost race with the sweep), so that case reports a
 * placeholder rather than throwing.
 */
async function psLineFor(pid) {
  try {
    const { stdout } = await execFileP("ps", [
      "-p",
      String(pid),
      "-o",
      "pid=,command=",
    ]);
    return stdout.trim() || `(pid ${pid} not found by ps)`;
  } catch {
    return `(pid ${pid} not found by ps)`;
  }
}

/**
 * Spawn one real ttyd with the EXACT argv `spawnTtyd` (`ttyd.ts`) uses — including the
 * `-t DISPATCH_TTYD_REVISION_6=1` retained key, without which boot-time `adoptAndSweep` cannot mark
 * it `compatible` for re-adoption — and resolve with its kernel-assigned port, parsed from stderr
 * the way the app's own `parsePort` does. `sessionId` (not `cardId`) is what the `-b` base-path
 * carries, matching production's own session-keyed base path (PROXY-01).
 * @see docs/ARCHITECTURE.md#terminal-ttyd
 */
function spawnTtyd(session, sessionId) {
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
        `=${session}`,
      ],
      { detached: true, stdio: ["ignore", "ignore", "pipe"] },
    );
    let buf = "";
    const timer = setTimeout(() => {
      reject(
        new Error(
          `ttyd port not reported within ${PORT_PARSE_TIMEOUT_MS}ms for ${session}`,
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
        new Error(`ttyd exited early (code ${code}) for ${session}: ${buf}`),
      );
    });
  });
}

/**
 * Spawn one REAL ttyd carrying the PRE-92 fingerprint on purpose: the retained key literal
 * `DISPATCH_TTYD_REVISION_5=1` (one revision behind {@link TTYD_REVISION_RETAINED_KEY}) and a
 * CARD-keyed `-b` base path (`/sessions/<cardId>/terminal`, the shape every ttyd carried before
 * PROXY-01 moved the base path to a session id). Deliberately NOT a call to {@link spawnTtyd} with
 * an older argument — the whole point of `--check orphan-sweep` is a process the CURRENT build
 * must classify as incompatible, so the old argv shape is spelled out here, standalone, rather than
 * threaded through the harness's own re-keyed spawn path.
 */
function spawnOrphanTtyd(session, cardId) {
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
        `/sessions/${cardId}/terminal`,
        "-t",
        "disableLeaveAlert=true",
        "-t",
        "DISPATCH_TTYD_REVISION_5=1",
        "tmux",
        "-u",
        "attach",
        "-t",
        `=${session}`,
      ],
      { detached: true, stdio: ["ignore", "ignore", "pipe"] },
    );
    let buf = "";
    const timer = setTimeout(() => {
      reject(
        new Error(
          `orphan ttyd port not reported within ${PORT_PARSE_TIMEOUT_MS}ms for ${session}`,
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
        new Error(
          `orphan ttyd exited early (code ${code}) for ${session}: ${buf}`,
        ),
      );
    });
  });
}

/**
 * Memoized `dist/server/adapters/git.js` load, dynamically `import()`ed only after
 * {@link assertBuilt} has run at least once in this process — see {@link DIST_GIT_ADAPTER}'s own
 * JSDoc for why a static top-level import would be unsafe here.
 */
let gitAdapterModule = null;
async function loadGitAdapter() {
  if (gitAdapterModule === null) {
    assertBuilt();
    gitAdapterModule = await import(DIST_GIT_ADAPTER);
  }
  return gitAdapterModule;
}

/** Memoized `dist/server/services/domain/workspace-paths.js` load — same discipline as {@link loadGitAdapter}. */
let workspacePathsModule = null;
async function loadWorkspacePathsAdapter() {
  if (workspacePathsModule === null) {
    assertBuilt();
    workspacePathsModule = await import(DIST_WORKSPACE_PATHS);
  }
  return workspacePathsModule;
}

/**
 * Create the throwaway local git repo every {@link WORKTREE_FIXTURE} session's worktree is cut
 * from — `git init` under the sandbox HOME (never a real project repo: Open Question 3 of
 * 93-RESEARCH.md is explicit that a real project repo must never be the fixture's target), one
 * committed `README.md` so a `baseRef` exists for `worktreeAddNewBranch`, and the repo's OWN
 * default branch name resolved via `git symbolic-ref --short HEAD` rather than hardcoded — `main`
 * vs `master` depends on the machine's git config, never on this file's assumption. `git config` is
 * set LOCALLY only (never `--global`), because `--global` would mutate the user's real git identity.
 */
async function seedFixtureRepo(built) {
  const repoPath = join(built.home, "repos", "alpha");
  assertUnderTmpdir(repoPath, "fixture repo");
  mkdirSync(repoPath, { recursive: true });
  await execFileP("git", ["init"], { cwd: repoPath });
  await execFileP("git", ["config", "user.email", "harness@localhost"], {
    cwd: repoPath,
  });
  await execFileP(
    "git",
    ["config", "user.name", "session-liveness-v3 harness"],
    { cwd: repoPath },
  );
  writeFileSync(join(repoPath, "README.md"), "fixture base\n");
  await execFileP("git", ["add", "README.md"], { cwd: repoPath });
  await execFileP("git", ["commit", "-m", "fixture base", "--no-gpg-sign"], {
    cwd: repoPath,
  });
  const { stdout } = await execFileP(
    "git",
    ["symbolic-ref", "--short", "HEAD"],
    { cwd: repoPath },
  );
  built.repoPath = repoPath;
  built.repoBase = stdout.trim();
}

/**
 * Insert the fixture card row directly via `node:sqlite` (the `migration-diff-v3.mjs` seeding
 * idiom) and pin `meta.schemaVersion` to `SESSION_SCHEMA_VERSION` (1) so boot runs no entity
 * migration over this hand-built `sessions[]`/`activeSessionId` shape — a warmup boot against the
 * empty sandbox home has already advanced a fresh install's schema version to 1
 * (91-01-SUMMARY.md), so this is a defensive re-assert, not a required correction.
 */
function seedFixtureCard(home, card) {
  const dbPath = join(home, DISPATCH_DIR_NAME, "board.db");
  const db = new DatabaseSync(dbPath);
  try {
    db.exec("BEGIN");
    db.prepare(
      `INSERT INTO cards (id, data) VALUES (?, ?)
       ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
    ).run(card.id, JSON.stringify(card));
    const metaRow = db.prepare("SELECT data FROM meta WHERE id = 0").get();
    const meta = metaRow ? JSON.parse(metaRow.data) : {};
    meta.schemaVersion = 1;
    db.prepare(
      `INSERT INTO meta (id, data) VALUES (0, @data)
       ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
    ).run({ data: JSON.stringify(meta) });
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  } finally {
    db.close();
  }
}

/**
 * Plant a stub `claude` executable under `home/bin/claude` (Plan 94-05). Returns the containing
 * `bin/` directory, the value {@link bootServer}'s `opts.pathPrefix` needs so
 * `resolveBinaryPath("claude")` (`resolve-binary.ts`, a bare `which claude`) resolves this stub
 * before any real install.
 * @remarks The stub MUST branch on its own argv, not merely block forever: boot itself calls the
 * resolved `claude` binary with `--version` (`hook-setup.ts#checkHooksCapability`, no timeout on
 * that `run()` call) BEFORE the sandbox server ever starts listening — a stub that always loops
 * would hang the server's own boot, not merely the saga. `--version` therefore prints a version
 * string BELOW `HOOKS_FLOOR` (`1.0.0`) and exits 0 immediately, so boot resolves `capable: false`
 * and the saga takes the simpler hook-silent launch branch (`steps.ts`'s `startClaude`), which
 * this fixture has no need to exercise. Any OTHER invocation (the real saga launch) prints ONE
 * line matching `steps.ts`'s `READY` regex — the literal
 * `bypass permissions on (shift+tab to cycle)`, never anything matching `TRUST_DIALOG` or
 * `BYPASS_DIALOG` — and then blocks forever in the exact `while true; do sleep 3600; done` shape
 * {@link tmuxNewSession}'s own stub panes already use, so `writePaneMarker`/`readPaneThroughProxy`
 * work against it unchanged (typed input echoes to the pane via the tty driver's local echo, not
 * because any process consumes it).
 */
function writeStubClaudeBinary(home) {
  const binDir = join(home, "bin");
  mkdirSync(binDir, { recursive: true });
  const claudePath = join(binDir, "claude");
  writeFileSync(
    claudePath,
    "#!/bin/sh\n" +
      'case " $* " in\n' +
      '  *" --version "*)\n' +
      '    echo "1.0.0 (Claude Code)"\n' +
      "    exit 0\n" +
      "    ;;\n" +
      "esac\n" +
      "echo 'bypass permissions on (shift+tab to cycle)'\n" +
      "while true; do sleep 3600; done\n",
    { mode: 0o755 },
  );
  return binDir;
}

/**
 * Overwrite the stub `claude` binary IN PLACE (same path {@link writeStubClaudeBinary} planted, so
 * no `PATH` change is needed) with a variant that EXITS IMMEDIATELY instead of blocking forever.
 * Used by {@link checkSecondStartRollbackDirection2} as the forced-failure vehicle: tmux's default
 * `remain-on-exit off` destroys a session the instant its sole pane's process exits, so the
 * session `startClaude.run` just created dies within tens of milliseconds of being created —
 * driven entirely by the product's own internal timing, before `awaitReplReady`'s own poll can
 * ever read its genuine exact-match pane. Live-verified (94-07-SUMMARY.md Deviations): once the
 * exact match is absent, EVERY `-t`-targeted tmux command this codebase's `steps.ts` issues with a
 * bare (non-`=`) target — `capturePane`, and (confirmed by direct reproduction) `paste-buffer` and
 * `send-keys` too — silently PREFIX-MATCHES onto the live suffixed sibling and reports SUCCESS
 * rather than throwing; none of `sendKickoff`'s own tmux calls can therefore ever surface this
 * absence as an exception. The only step immune to that silent-success trap is
 * `awaitReplReady`'s own hardcoded 30s `READINESS_TIMEOUT_MS` wall-clock deadline, which fires
 * regardless of what `capturePane` returns and throws a genuine `StartStepError("starting claude",
 * ..., "repl-timeout")` — the deterministic (if slow) route to `startClaude.undo` this direction
 * relies on. An already-running session (e.g. session 2 from an earlier `newSession` call under
 * the ORIGINAL stub) is unaffected: its process already exec'd the old script's bytes into memory
 * before this overwrite.
 */
function writeExitingStubClaudeBinary(home) {
  const binDir = join(home, "bin");
  const claudePath = join(binDir, "claude");
  writeFileSync(
    claudePath,
    "#!/bin/sh\n" +
      'case " $* " in\n' +
      '  *" --version "*)\n' +
      '    echo "1.0.0 (Claude Code)"\n' +
      "    exit 0\n" +
      "    ;;\n" +
      "esac\n" +
      "exit 0\n",
    { mode: 0o755 },
  );
  return binDir;
}

/** `{ exists, mtimeMs, size }` for `path`, or an all-null/false shape when it doesn't exist. */
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

/**
 * No pre-existing harness tmux session and nothing already bound to the sandbox port — a prior
 * run's teardown must have failed silently for either to be true, and this run must not layer on
 * top of a leak rather than surface it.
 */
async function assertPreflightClean(built) {
  const existing = (await tmuxListSessionNames()).filter((n) =>
    n.startsWith(built.tmuxPrefix),
  );
  if (existing.length > 0) {
    throw new Error(
      `refusing to start — tmux sessions already present with prefix "${built.tmuxPrefix}": ${existing.join(", ")}`,
    );
  }
  if (await isPortListening(built.port)) {
    throw new Error(
      `refusing to start — something is already LISTENING on sandbox port ${built.port}`,
    );
  }
  console.log(
    `preflight: 0 tmux sessions with prefix "${built.tmuxPrefix}"; port ${built.port} free`,
  );
}

/**
 * Memoized result of the one server compile per process — see {@link assertBuilt}. `null` until the
 * first call; every later call reuses it, so the many `dist` boots a multi-fixture check performs
 * cost exactly one `tsc` run between them.
 */
let serverBuild = null;

/**
 * Compile the server the harness is about to boot, then confirm the entry point exists.
 *
 * This REPLACES an existence-only precondition that was actively misleading: the harness boots
 * `dist`, never `src` (see {@link bootServer}), so a `dist` predating a source fix reported that
 * fix as absent — a correct source tree failing its own proof, with the violation text blaming
 * store/watcher code that already read correctly. Detecting that by mtime is not sound here:
 * `tsc` leaves an output file untouched when its emitted text is unchanged, so `dist` legitimately
 * holds artifacts months older than the last build, and a comment-only source edit (this codebase
 * is JSDoc-dense) would trip an mtime guard that no rebuild could clear. Compiling unconditionally
 * makes the staleness class structurally impossible rather than merely detectable.
 *
 * `stdio: "pipe"` keeps a clean transcript on success while folding `tsc`'s own diagnostics into
 * the thrown error on failure — a source tree that does not compile must stop the run outright,
 * never fall through to boot the previous build and report its behaviour as today's.
 *
 * The one-line announcement is emitted from the compiling call ONLY, never from the memoized ones:
 * `--check all` funnels six checks and every fixture boot through here, and reprinting the same
 * duration each time would read as six compiles of a suspiciously identical length.
 */
function assertBuilt() {
  if (serverBuild !== null) return serverBuild;
  const startedAt = Date.now();
  try {
    execFileSync("npm", ["run", BUILD_SERVER_SCRIPT], {
      cwd: REPO_ROOT,
      stdio: "pipe",
    });
  } catch (err) {
    const detail = [err.stdout?.toString(), err.stderr?.toString()]
      .filter(Boolean)
      .join("\n")
      .trim();
    throw new Error(
      `refusing to run — \`npm run ${BUILD_SERVER_SCRIPT}\` failed, so dist/ does not reflect ` +
        `src/ and any result would describe code you are not running:\n${detail || err.message}`,
    );
  }
  if (!existsSync(DIST_ENTRY)) {
    throw new Error(
      `Missing ${DIST_ENTRY} after a successful \`npm run ${BUILD_SERVER_SCRIPT}\` — run \`npm run build\` first.`,
    );
  }
  serverBuild = { durationMs: Date.now() - startedAt };
  console.log(
    `preflight: compiled src/ -> dist/ via \`npm run ${BUILD_SERVER_SCRIPT}\` in ${serverBuild.durationMs}ms — every boot below runs current source`,
  );
  return serverBuild;
}

/**
 * Stand up the fixture, mutating `built` incrementally as each real resource comes up so a
 * mid-standup failure still leaves {@link tearDownFixture} enough state to clean up whatever DID
 * start. Order: a warmup boot against the still-cardless sandbox home to create the sqlite schema
 * FIRST, then one real tmux session PER `built.sessionKeys` entry (verified via
 * `tmux list-sessions`), then one real ttyd each matching the app's exact spawn argv (verified
 * LISTENING via `lsof`), the fixture card seeded directly owning exactly those session records,
 * then the real boot the checks run against. The FIRST key is always the active session, so a
 * one-key profile yields a card whose sole session is also its active one.
 * @remarks The warmup boot MUST precede the ttyd spawns, not follow them — `main()`'s own boot
 * sequence runs `reconcileSessions()` unconditionally, and a warmup boot against a still-empty
 * sandbox (no fixture card exists yet) resolves an EMPTY `sessionsWithTmux()` candidates list, so
 * `adoptAndSweep` would spare nothing and sweep EVERY one of this harness's own freshly-spawned,
 * fingerprint-matched ttyd processes as unrecognized orphans before the fixture card seeding step
 * ever runs — empirically confirmed by Phase 91's own `--check safety` proof run, corrected here.
 * @remarks Each session's `id` is minted (`randomUUID`) BEFORE its ttyd spawn, not after, so the
 * exact id `spawnTtyd` bakes into the `-b` base path is the SAME id later persisted onto the
 * session record (PROXY-01) — spawning with one id and persisting another would leave the
 * persisted record's own proxy path pointing at a ttyd that never used it.
 * @remarks When `built.worktrees` is set ({@link WORKTREE_FIXTURE}, Phase 93), a throwaway repo is
 * seeded first ({@link seedFixtureRepo}) and each session record gets a REAL, git-registered
 * worktree cut with production's own `worktreeAddNewBranch` before the fixture card is seeded, and
 * carries both `workspacePath` and `workspace.repos` (the v3.0-migrated shape) rather than
 * `workspacePath` alone. Every other profile leaves `built.worktrees` unset and takes none of this
 * path, so their behaviour is unchanged.
 */
/**
 * Stand up {@link SECOND_SESSION_FIXTURE}: session 1 named and worktree-homed exactly as the real
 * product would (`dsp-<identifier>`, `workspaces/<identifier>/alpha`, branch `<identifier>`), plus
 * a stub `claude` executable on the sandbox's own `bin/` directory so the real start saga's
 * readiness poll resolves in milliseconds when the harness later drives session 2 through it.
 * @remarks Same warmup-before-ttyd ordering hazard {@link standUpFixture}'s own remarks document
 * (a cardless warmup's `reconcileSessions()` would sweep this fixture's own freshly-spawned ttyd)
 * — the warmup boot runs first here too, before session 1's tmux/ttyd exist.
 * @remarks Session 2 is deliberately NOT created here: it is created by the checks themselves,
 * driving the real `POST /cards/:id/start` route ({@link startSecondSession}) against the server
 * booted at the end of this function — that is the entire point of this fixture shape.
 */
async function standUpRealSagaFixture(built) {
  const warmup = bootServer(built.home);
  await waitForReady(built.port);
  await killAndWait(warmup.child);

  built.tmux.a = `dsp-${built.identifier}`;
  await tmuxNewSession(built.tmux.a, built.home);
  const live = await tmuxListSessionNames();
  if (!live.includes(built.tmux.a)) {
    throw new Error(
      `session 1 tmux session did not come up: missing ${built.tmux.a}, live=${JSON.stringify(live)}`,
    );
  }
  console.log(`standup (real-saga): tmux session 1 live — ${built.tmux.a}`);

  const handle = { id: randomUUID(), token: randomBytes(32).toString("hex") };
  built.sessionA = handle;
  built.ttyd.a = await spawnTtyd(built.tmux.a, handle.id);
  await waitForPortListening(built.ttyd.a.port);
  console.log(
    `standup (real-saga): ttyd for session 1 LISTENING — ${built.ttyd.a.port}`,
  );

  await seedFixtureRepo(built);
  console.log(
    `standup (real-saga): fixture repo ready — ${built.repoPath} (base ${built.repoBase})`,
  );

  const { worktreeAddNewBranch } = await loadGitAdapter();
  const { worktreePath } = await loadWorkspacePathsAdapter();

  const workspacePath = join(built.home, "workspaces", built.identifier);
  assertUnderTmpdir(workspacePath, "workspace path (session 1)");
  mkdirSync(workspacePath, { recursive: true });
  const wtPath = worktreePath(workspacePath, built.repoPath);
  assertUnderTmpdir(wtPath, "worktree path (session 1)");
  await worktreeAddNewBranch(
    built.repoPath,
    wtPath,
    built.identifier,
    built.repoBase,
  );
  built.session1WorktreePath = wtPath;
  built.session1WorkspacePath = workspacePath;
  built.session1Branch = built.identifier;
  writeFileSync(
    join(wtPath, "session-a.txt"),
    "fixture worktree for session 1\n",
  );
  await execFileP("git", ["add", "session-a.txt"], { cwd: wtPath });
  await execFileP(
    "git",
    ["commit", "-m", "fixture session 1", "--no-gpg-sign"],
    { cwd: wtPath },
  );
  console.log(`standup (real-saga): session 1 worktree registered — ${wtPath}`);

  const now = new Date().toISOString();
  const record = {
    id: handle.id,
    createdAt: now,
    updatedAt: now,
    tmuxSession: built.tmux.a,
    ttydPort: built.ttyd.a.port,
    hookToken: handle.token,
    workspacePath,
    branch: built.identifier,
    workspace: {
      folder: join(built.home, "repos"),
      repos: [{ path: built.repoPath, base: built.repoBase }],
    },
  };
  const card = {
    id: built.cardId,
    issueId: `${built.cardId}-issue`,
    identifier: built.identifier,
    title: "session-liveness-v3 real-saga fixture card — 1 real session",
    description: null,
    priority: 3,
    column: "in_progress",
    updatedAt: now,
    sessions: [record],
    activeSessionId: record.id,
    tmuxSession: record.tmuxSession,
    ttydPort: record.ttydPort,
    hookToken: record.hookToken,
    workspacePath: record.workspacePath,
    workspace: record.workspace,
    branch: record.branch,
  };
  seedFixtureCard(built.home, card);

  built.pathPrefix = writeStubClaudeBinary(built.home);
  console.log(
    `standup (real-saga): stub claude planted — ${join(built.pathPrefix, "claude")}`,
  );

  built.server = bootServer(built.home, { pathPrefix: built.pathPrefix });
  await waitForReady(built.port);
  console.log(`standup (real-saga): sandbox server ready on :${built.port}`);
}

async function standUpFixture(built) {
  if (built.realSaga) return standUpRealSagaFixture(built);
  const warmup = bootServer(built.home);
  await waitForReady(built.port);
  await killAndWait(warmup.child);

  for (const key of built.sessionKeys) {
    built.tmux[key] = `${built.tmuxPrefix}${key}`;
    await tmuxNewSession(built.tmux[key], built.home);
  }
  const live = await tmuxListSessionNames();
  const missing = built.sessionKeys
    .map((key) => built.tmux[key])
    .filter((name) => !live.includes(name));
  if (missing.length > 0) {
    throw new Error(
      `tmux sessions did not all come up: missing ${missing.join(", ")}, live=${JSON.stringify(live)}`,
    );
  }
  console.log(
    `standup: tmux sessions live — ${built.sessionKeys.map((key) => built.tmux[key]).join(", ")}`,
  );

  const handles = {};
  for (const key of built.sessionKeys) {
    handles[key] = { id: randomUUID(), token: randomBytes(32).toString("hex") };
    built[SESSION_FIELD_BY_KEY[key]] = handles[key];
  }

  for (const key of built.sessionKeys) {
    built.ttyd[key] = await spawnTtyd(built.tmux[key], handles[key].id);
  }
  for (const key of built.sessionKeys) {
    await waitForPortListening(built.ttyd[key].port);
  }
  console.log(
    `standup: ttyd ports LISTENING — ${built.sessionKeys.map((key) => `${key}=${built.ttyd[key].port}`).join(", ")}`,
  );

  if (built.worktrees) {
    await seedFixtureRepo(built);
    console.log(
      `standup: fixture repo ready — ${built.repoPath} (base ${built.repoBase})`,
    );
  }
  const { worktreeAddNewBranch } = built.worktrees
    ? await loadGitAdapter()
    : {};
  const { worktreePath } = built.worktrees
    ? await loadWorkspacePathsAdapter()
    : {};

  const now = new Date().toISOString();
  const records = [];
  for (const key of built.sessionKeys) {
    const handle = handles[key];
    const workspacePath = join(
      built.home,
      "workspaces",
      WORKSPACE_SUFFIX_BY_SESSION_KEY[key],
    );
    const record = {
      id: handle.id,
      createdAt: now,
      updatedAt: now,
      tmuxSession: built.tmux[key],
      ttydPort: built.ttyd[key].port,
      hookToken: handle.token,
      workspacePath,
    };
    if (built.worktrees) {
      assertUnderTmpdir(workspacePath, `workspace path (session ${key})`);
      mkdirSync(workspacePath, { recursive: true });
      const wtPath = worktreePath(workspacePath, built.repoPath);
      assertUnderTmpdir(wtPath, `worktree path (session ${key})`);
      const branch = `dispatch/93-${key}`;
      await worktreeAddNewBranch(
        built.repoPath,
        wtPath,
        branch,
        built.repoBase,
      );
      built.branches[key] = branch;
      built.worktreePaths[key] = wtPath;
      const trackedFileName = `session-${key}.txt`;
      writeFileSync(
        join(wtPath, trackedFileName),
        `fixture worktree for session ${key}\n`,
      );
      await execFileP("git", ["add", trackedFileName], { cwd: wtPath });
      await execFileP(
        "git",
        ["commit", "-m", `fixture session ${key}`, "--no-gpg-sign"],
        { cwd: wtPath },
      );
      record.workspace = {
        folder: join(built.home, "repos"),
        repos: [{ path: built.repoPath, base: built.repoBase }],
      };
    }
    records.push(record);
  }
  if (built.worktrees) {
    console.log(
      `standup: worktrees registered — ${built.sessionKeys.map((key) => `${key}=${built.worktreePaths[key]}`).join(", ")}`,
    );
  }
  const [activeRecord] = records;

  const card = {
    id: built.cardId,
    issueId: `${built.cardId}-issue`,
    identifier: "SHL-1",
    title: `session-liveness-v3 harness fixture card — ${records.length} real session${records.length === 1 ? "" : "s"}`,
    description: null,
    priority: 3,
    column: "in_progress",
    updatedAt: now,
    sessions: records,
    activeSessionId: activeRecord.id,
    tmuxSession: activeRecord.tmuxSession,
    ttydPort: activeRecord.ttydPort,
    hookToken: activeRecord.hookToken,
    workspacePath: activeRecord.workspacePath,
    workspace: activeRecord.workspace,
  };
  seedFixtureCard(built.home, card);

  built.server = bootServer(built.home);
  await waitForReady(built.port);
  console.log(`standup: sandbox server ready on :${built.port}`);
}

/**
 * Unconditional teardown: kill the server, kill every ttyd (falling back to the `lsof`-resolved PID
 * for one that survives its own SIGTERM), kill every tmux session, remove the sandbox home — THEN
 * verify each of those actually happened, pushing a violation for anything still present rather
 * than assuming success. Runs against whatever fields `built` has populated, so a fixture that
 * failed partway through standup still gets torn down as far as it got.
 * @remarks The leaked-tmux sweep filters on the RUNNING fixture's own prefix, never on a module
 * constant: a fixture profile must never be able to report a sibling profile's leak as its own,
 * nor stay silent about its own because it looked for the wrong prefix.
 * @remarks When `built.worktrees` is set, each session's real worktree is removed via production's
 * own `worktreeRemove` and the throwaway repo is deleted, BOTH before the blanket sandbox-home
 * `rmSync` below — the blanket removal would otherwise silently paper over a `worktreeRemove`
 * failure that left a stale git-admin registration, since the directory disappears either way.
 * `assertUnderTmpdir` guards each removal and is allowed to throw uncaught here (unlike
 * `worktreeRemove`'s own failure, which is caught and turned into a violation): a containment
 * failure during teardown must halt hard, never degrade into a logged violation.
 */
async function tearDownFixture(built, violations) {
  if (built.realSaga) return tearDownRealSagaFixture(built, violations);
  await killAndWait(built.server?.child);

  for (const key of built.sessionKeys) {
    const t = built.ttyd[key];
    if (t?.child) {
      try {
        t.child.kill("SIGTERM");
      } catch {
        // already gone
      }
    }
  }
  await sleep(300);
  for (const key of built.sessionKeys) {
    const t = built.ttyd[key];
    if (!t) continue;
    if (await isPortListening(t.port)) {
      for (const pid of await pidsListeningOnPort(t.port)) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          // already gone
        }
      }
    }
  }

  for (const key of built.sessionKeys) {
    if (built.tmux[key]) await tmuxKillSession(built.tmux[key]);
  }

  if (built.orphan) {
    if (built.orphan.child) {
      try {
        built.orphan.child.kill("SIGTERM");
      } catch {
        // already gone
      }
    }
    await sleep(300);
    if (await isPortListening(built.orphan.port)) {
      for (const pid of await pidsListeningOnPort(built.orphan.port)) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          // already gone
        }
      }
    }
    if (built.orphan.tmuxName) await tmuxKillSession(built.orphan.tmuxName);
  }

  if (built.worktrees) {
    for (const key of built.sessionKeys) {
      const wtPath = built.worktreePaths[key];
      if (!wtPath || !existsSync(wtPath)) continue;
      assertUnderTmpdir(wtPath, `worktree path (session ${key})`);
      try {
        const { worktreeRemove } = await loadGitAdapter();
        await worktreeRemove(built.repoPath, wtPath);
      } catch (err) {
        violations.push(
          `teardown: worktreeRemove failed for session ${key} (${wtPath}): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    if (built.repoPath && existsSync(built.repoPath)) {
      assertUnderTmpdir(built.repoPath, "fixture repo");
      rmSync(built.repoPath, { recursive: true, force: true });
    }
  }

  if (built.home && existsSync(built.home)) {
    rmSync(built.home, { recursive: true, force: true });
  }

  const remaining = (await tmuxListSessionNames()).filter((n) =>
    n.startsWith(built.tmuxPrefix),
  );
  if (remaining.length > 0) {
    violations.push(
      `teardown: tmux sessions still present after kill-session: ${remaining.join(", ")}`,
    );
  }
  for (const key of built.sessionKeys) {
    const t = built.ttyd[key];
    if (t && (await isPortListening(t.port))) {
      violations.push(
        `teardown: ttyd port ${t.port} (session ${key}) still LISTENING after kill`,
      );
    }
  }
  if (built.orphan && (await isPortListening(built.orphan.port))) {
    violations.push(
      `teardown: planted orphan ttyd port ${built.orphan.port} still LISTENING after kill`,
    );
  }
  if (await isPortListening(built.port)) {
    violations.push(
      `teardown: sandbox port ${built.port} still LISTENING after server kill`,
    );
  }
  if (built.home && existsSync(built.home)) {
    violations.push(
      `teardown: sandbox home ${built.home} still exists after rmSync`,
    );
  }
  if (built.worktrees) {
    for (const key of built.sessionKeys) {
      const wtPath = built.worktreePaths[key];
      if (wtPath && existsSync(wtPath)) {
        violations.push(
          `teardown: worktree path for session ${key} still exists after worktreeRemove: ${wtPath}`,
        );
      }
    }
    if (built.repoPath && existsSync(built.repoPath)) {
      violations.push(
        `teardown: fixture repo still exists after removal: ${built.repoPath}`,
      );
    }
  }
}

/**
 * Poll `GET /api/board` on `port` until it REFUSES to connect (the sandbox server is actually
 * gone), or `timeoutMs` elapses. A server that still answers after its own kill is not a warning —
 * `94-VALIDATION.md`'s standing rule (a sandboxed server is not sandboxed in its machine-wide
 * sweep) makes a leaked-but-reported-dead server a real hazard, so the caller turns a `false`
 * return into a violation rather than logging and moving on.
 */
async function waitForServerGone(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/board`);
      await res.body?.cancel().catch(() => {});
    } catch {
      return true;
    }
    await sleep(POLL_INTERVAL_MS);
  }
  return false;
}

/**
 * Teardown for {@link SECOND_SESSION_FIXTURE}: removes what the REAL SAGA created, not only what
 * {@link standUpRealSagaFixture} created — session 2's tmux session, worktree and branch exist
 * only because a check drove `POST /start` through the real route, so this function discovers them
 * rather than assuming a fixed shape.
 * @remarks Every tmux kill against a name that can be a PREFIX of a sibling (`dsp-<identifier>`
 * beside `dsp-<identifier>-2`) uses {@link tmuxKillSessionExact} against a name READ BACK from
 * `tmux list-sessions`, never a bare prefix target — the harness must not reproduce the very bug
 * this fixture exists to catch.
 * @remarks Worktree cleanup is driven by `git worktree list --porcelain` (never a hardcoded path
 * list), so session 2's worktree — whose exact path this function never independently computes —
 * is discovered and removed the same way session 1's is.
 */
async function tearDownRealSagaFixture(built, violations) {
  await killAndWait(built.server?.child);
  const serverGone = await waitForServerGone(
    built.port,
    LISTEN_POLL_TIMEOUT_MS,
  );
  if (!serverGone) {
    violations.push(
      `teardown (real-saga): sandbox server on :${built.port} still answers GET /api/board after kill`,
    );
  }

  const ttydA = built.ttyd.a;
  if (ttydA?.child) {
    try {
      ttydA.child.kill("SIGTERM");
    } catch {
      // already gone
    }
  }
  await sleep(300);
  if (ttydA && (await isPortListening(ttydA.port))) {
    for (const pid of await pidsListeningOnPort(ttydA.port)) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // already gone
      }
    }
  }

  const liveNames = (await tmuxListSessionNames()).filter((n) =>
    n.startsWith(`dsp-${built.identifier}`),
  );
  for (const name of liveNames) {
    await tmuxKillSessionExact(name);
  }

  if (built.repoPath && existsSync(built.repoPath)) {
    try {
      const registered = await gitWorktreeListRegistered(built.repoPath);
      const { worktreeRemove, worktreePrune } = await loadGitAdapter();
      const mainWorktree = realpathSync(built.repoPath);
      for (const wtPath of registered) {
        if (wtPath === mainWorktree) continue;
        assertUnderTmpdir(wtPath, "real-saga worktree path");
        try {
          await worktreeRemove(built.repoPath, wtPath);
        } catch (err) {
          violations.push(
            `teardown (real-saga): worktreeRemove failed for ${wtPath}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      await worktreePrune(built.repoPath).catch(() => {});
    } catch (err) {
      violations.push(
        `teardown (real-saga): worktree enumeration/removal failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    assertUnderTmpdir(built.repoPath, "fixture repo");
    rmSync(built.repoPath, { recursive: true, force: true });
  }

  if (built.home && existsSync(built.home)) {
    assertUnderTmpdir(built.home, "sandbox home");
    rmSync(built.home, { recursive: true, force: true });
  }

  const remaining = (await tmuxListSessionNames()).filter((n) =>
    n.startsWith(`dsp-${built.identifier}`),
  );
  if (remaining.length > 0) {
    violations.push(
      `teardown (real-saga): tmux sessions still present after kill-session: ${remaining.join(", ")}`,
    );
  }
  if (ttydA && (await isPortListening(ttydA.port))) {
    violations.push(
      `teardown (real-saga): ttyd port ${ttydA.port} (session 1) still LISTENING after kill`,
    );
  }
  if (await isPortListening(built.port)) {
    violations.push(
      `teardown (real-saga): sandbox port ${built.port} still LISTENING after server kill`,
    );
  }
  if (built.home && existsSync(built.home)) {
    violations.push(
      `teardown (real-saga): sandbox home ${built.home} still exists after rmSync`,
    );
  }
  if (built.repoPath && existsSync(built.repoPath)) {
    violations.push(
      `teardown (real-saga): fixture repo still exists after removal: ${built.repoPath}`,
    );
  }
}

/**
 * One complete fixture lifecycle: preflight, a fresh sandbox home under `label`, one real tmux
 * session and one real ttyd per `profile.sessionKeys` entry, `fn(built)`, then
 * unconditional-and-verified teardown — regardless of what `fn` returns or throws. Every check in
 * {@link CHECKS} is built on this: `safety`, `hook-attribution` and `single-session` call it
 * exactly once; `liveness` and `reconcile` call it more than once within a single `--check`
 * invocation, because each needs a fixture that starts from BOTH sessions live, independent of any
 * prior direction/stage's own mutation — a rebuilt fixture per kill direction for `liveness`, a
 * live-restart stage plus a fresh dead-session-before-restart stage for `reconcile`.
 * {@link assertPreflightClean} is re-run at the top of every call, not once per `--check`
 * invocation, so a fixture rebuilt mid-check still refuses to layer onto a leak the prior cycle's
 * own teardown left behind.
 * @remarks `profile` defaults to {@link TWO_SESSION_FIXTURE} so every check that predates the
 * profile split keeps the exact fixture it was written against; `single-session` is the only
 * caller that passes {@link SINGLE_SESSION_FIXTURE}.
 */
async function withFixture(label, fn, profile = TWO_SESSION_FIXTURE) {
  const violations = [];
  const home = makeSandboxHome(label, profile.port);
  const built = {
    home,
    cardId: FIXTURE_CARD_ID,
    port: profile.port,
    tmuxPrefix: profile.tmuxPrefix,
    sessionKeys: profile.sessionKeys,
    worktrees: profile.worktrees === true,
    realSaga: profile.realSaga === true,
    identifier: profile.identifier,
    tmux: {},
    ttyd: {},
    server: null,
    sessionA: null,
    sessionB: null,
    dbPath: join(home, DISPATCH_DIR_NAME, "board.db"),
    repoPath: null,
    repoBase: null,
    branches: {},
    worktreePaths: {},
  };
  try {
    await assertPreflightClean(built);
    assertBuilt();
    await standUpFixture(built);
    violations.push(...(await fn(built)));
  } catch (err) {
    violations.push(
      `run failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
    );
  } finally {
    await tearDownFixture(built, violations);
  }
  return violations;
}

/**
 * Resolve the fixture card exactly as `GET /api/board` — the wire the UI itself consumes —
 * reports it: `redactCard`'s shape, never the store's own in-memory `Card`. A non-active
 * sibling's own fields are therefore NEVER visible here (`redactCard` strips `sessions` and
 * projects only `activeSession`); the `liveness` sub-check's non-active kill direction reads the
 * persisted record directly for that reason. Tolerant of a transient fetch failure (a dropped
 * connection mid-poll) — resolves `undefined` rather than throwing, so a long poll loop degrades
 * to "not yet observed" instead of crashing the check.
 */
async function fetchFixtureCard(built) {
  try {
    const res = await fetch(`http://127.0.0.1:${built.port}/api/board`);
    const body = await res.json();
    const cards = Array.isArray(body?.cards) ? body.cards : [];
    return cards.find((c) => c.id === built.cardId);
  } catch {
    return undefined;
  }
}

/**
 * Kill the sandbox server and boot it again against the SAME sandbox home — tmux and ttyd are
 * left untouched by this call, so it is a backend-only restart. Reused by both `reconcile`
 * stages (Task 2): a live restart (stage 1, both sessions still live) and a restart with one
 * session already dead (stage 2). `bootServer` always re-captures fresh `logLines`, so a stage
 * that greps the post-restart `[reconcile]` boot line never sees a pre-restart line by accident.
 */
async function restartServer(built) {
  await killAndWait(built.server?.child);
  built.server = bootServer(built.home);
  await waitForReady(built.port);
}

/**
 * The scaffolding's own falsifiable subject (Task 1): both real tmux sessions appear in
 * `tmux list-sessions`, both real ttyd ports are confirmed LISTENING via `lsof`. No hook traffic,
 * no persisted-state assertions — those belong to the `hook-attribution` check.
 */
async function checkSafety(built) {
  const violations = [];
  const live = (await tmuxListSessionNames()).filter((n) =>
    n.startsWith(built.tmuxPrefix),
  );
  console.log(
    `safety: tmux sessions live with our prefix = ${JSON.stringify(live)}`,
  );
  if (!live.includes(built.tmux.a)) {
    violations.push(
      `tmux session ${built.tmux.a} not found in tmux list-sessions`,
    );
  }
  if (!live.includes(built.tmux.b)) {
    violations.push(
      `tmux session ${built.tmux.b} not found in tmux list-sessions`,
    );
  }
  const aListening = await isPortListening(built.ttyd.a.port);
  const bListening = await isPortListening(built.ttyd.b.port);
  console.log(
    `safety: ttyd A port=${built.ttyd.a.port} listening=${aListening}`,
  );
  console.log(
    `safety: ttyd B port=${built.ttyd.b.port} listening=${bListening}`,
  );
  if (!aListening) {
    violations.push(`ttyd port ${built.ttyd.a.port} (session A) not LISTENING`);
  }
  if (!bListening) {
    violations.push(`ttyd port ${built.ttyd.b.port} (session B) not LISTENING`);
  }
  return violations;
}

/** The exact `DISPATCH_STATUS: NEEDS_INPUT — <reason>` Stop-payload text `parse.ts#MARKER_RE` matches. */
function stopBodyWithReason(reason) {
  return {
    hook_event_name: "Stop",
    last_assistant_message: `⏺ DISPATCH_STATUS: NEEDS_INPUT — ${reason}`,
  };
}

/**
 * POST `{ column }` to the real `/api/cards/:id/move` route — never a direct `store.moveCardManual`
 * call — so the fixture card's transition to Done goes through the SAME guard chain (grouped-member
 * refusal, the inbox/manual-move allowlists) a real drag would, and stamps `cleanupDueAt` on every
 * eligible session exactly the way genuine Done arrival does.
 */
async function moveCard(built, column) {
  const res = await fetch(
    `http://127.0.0.1:${built.port}/api/cards/${built.cardId}/move`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ column }),
    },
  );
  await res.body?.cancel().catch(() => {});
  return res.status;
}

/** POST `opts` to the real `/api/cards/:id/cleanup` route — the manual fan-out entry point. */
async function postCleanup(built, opts) {
  const res = await fetch(
    `http://127.0.0.1:${built.port}/api/cards/${built.cardId}/cleanup`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(opts),
    },
  );
  await res.body?.cancel().catch(() => {});
  return res.status;
}

/**
 * POST the REAL `/api/cards/:id/start` route (Plan 94-05) — never a direct `store`/saga call — so
 * a second-session check exercises the exact same request path a real drag-triggered "Start
 * another session" click sends: server-side 409 re-validation, the reserve-before-run store step,
 * and every saga step in between.
 */
async function startSecondSession(built, { newSession }) {
  const res = await fetch(
    `http://127.0.0.1:${built.port}/api/cards/${built.cardId}/start`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ extraDirection: "", newSession }),
    },
  );
  const body = await res.json().catch(() => undefined);
  return { status: res.status, body };
}

/**
 * Poll {@link fetchFixtureCard} until the real saga has SETTLED: `provisioningStep` is `null` AND
 * either a second session has landed (`sessionCount >= 2` — `redactCard` emits this field only at
 * N>=2) or the saga recorded a `startError`. Returns `{ card, timedOut }` rather than throwing on a
 * timeout, so a caller can report the LAST OBSERVED card state as part of a named violation instead
 * of an opaque exception.
 */
async function waitForSagaSettled(built, { timeoutMs }) {
  const deadline = Date.now() + timeoutMs;
  let card;
  while (Date.now() < deadline) {
    card = await fetchFixtureCard(built);
    const settled =
      card != null &&
      card.provisioningStep == null &&
      ((card.sessionCount ?? 1) >= 2 || card.startError != null);
    if (settled) return { card, timedOut: false };
    await sleep(POLL_INTERVAL_MS);
  }
  return { card, timedOut: true };
}

/**
 * `git -C <repoPath> worktree list --porcelain`, parsed into a `Set` of realpath-resolved
 * registered worktree paths — registration reads, never `existsSync` (the C1 dead-instrument
 * hazard {@link checkCleanupFixture}'s own header already names: a directory survives on disk
 * regardless of whether it is still git-registered). A path that no longer exists on disk is kept
 * unresolved in the set (there is nothing for `realpathSync` to resolve), which only matters for a
 * caller checking a path that was never real to begin with.
 */
async function gitWorktreeListRegistered(repoPath) {
  const { stdout } = await execFileP(
    "git",
    ["worktree", "list", "--porcelain"],
    { cwd: repoPath },
  );
  const registered = new Set();
  for (const line of stdout.split("\n")) {
    if (!line.startsWith("worktree ")) continue;
    const p = line.slice("worktree ".length);
    registered.add(existsSync(p) ? realpathSync(p) : p);
  }
  return registered;
}

/**
 * `true` iff any process's full command line (`ps -ax -o pid=,command=`) contains `needle` — used
 * by the DELETE-BEFORE-KILL assertion to confirm no ttyd ANYWHERE on the machine still carries a
 * cleaned session's id in its `-b /sessions/<id>/terminal` argv after a restart, independent of
 * whether {@link isPortListening} still resolves a (possibly different, re-spawned) process on the
 * same port.
 */
async function psScanContains(needle) {
  try {
    const { stdout } = await execFileP("ps", ["-ax", "-o", "pid=,command="]);
    return stdout.split("\n").some((line) => line.includes(needle));
  } catch {
    return false;
  }
}

/** POST `body` to the sandbox's `/api/hook/claude` route carrying `token`, returning the response status. */
async function postHook(built, token, body) {
  const res = await fetch(`http://127.0.0.1:${built.port}/api/hook/claude`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-dispatch-token": token,
    },
    body: JSON.stringify(body),
  });
  await res.body?.cancel().catch(() => {});
  return res.status;
}

/**
 * POST a `UserPromptSubmit` hook event through `token` — the exact event `applyPromptSubmit`
 * (`hook-events.ts:171`) maps onto `store.flipBack`, driving the cross-session gate this file's
 * `--check attention` proves. No message body is required: `applyPromptSubmit` binds only on the
 * event name plus the token-resolved session identity, never on payload text.
 */
async function postPromptSubmit(built, token) {
  const res = await fetch(`http://127.0.0.1:${built.port}/api/hook/claude`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-dispatch-token": token,
    },
    body: JSON.stringify({ hook_event_name: "UserPromptSubmit" }),
  });
  await res.body?.cancel().catch(() => {});
  return res.status;
}

/** Read one persisted card row via a FRESH `readOnly: true` node:sqlite connection, or `undefined`. */
function readCard(dbPath, cardId) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const row = db.prepare("SELECT data FROM cards WHERE id = ?").get(cardId);
    return row ? JSON.parse(row.data) : undefined;
  } finally {
    db.close();
  }
}

/**
 * Per-session hook attribution proof (Task 2, HOOK-01): POST a NEEDS_INPUT Stop marker carrying a
 * reason unique to EACH real session's own token, POST once more with a token that was never
 * minted, then kill the server and re-read the persisted card through a fresh `readOnly: true`
 * connection — never through the still-live process — and assert against the PERSISTED session
 * records, KEYED BY SESSION ID, never by array position or "two distinct markers exist somewhere
 * on this card": {@link expectedReasonBySessionId} is an explicit session-id-keyed map so the
 * assertion is always "THIS session got THIS marker".
 * @remarks A mismatch is annotated with a cross-attribution note when the actual value equals a
 * SIBLING session's expected value — the exact shape Task 3's Break A (mis-registration against
 * `card.activeSessionId`) and Break B (a swapped expectation table) both need surfaced plainly.
 */
async function checkHookAttribution(built) {
  const violations = [];
  const reasonA = "reason-unique-to-session-A";
  const reasonB = "reason-unique-to-session-B";

  const statusA = await postHook(
    built,
    built.sessionA.token,
    stopBodyWithReason(reasonA),
  );
  console.log(
    `hook-attribution: POST session ${built.sessionA.id} (token A) -> ${statusA} (expected 204)`,
  );
  if (statusA !== 204) {
    violations.push(
      `session ${built.sessionA.id}: POST with its own token returned ${statusA}, expected 204`,
    );
  }

  const statusB = await postHook(
    built,
    built.sessionB.token,
    stopBodyWithReason(reasonB),
  );
  console.log(
    `hook-attribution: POST session ${built.sessionB.id} (token B) -> ${statusB} (expected 204)`,
  );
  if (statusB !== 204) {
    violations.push(
      `session ${built.sessionB.id}: POST with its own token returned ${statusB}, expected 204`,
    );
  }

  const unmintedToken = randomBytes(32).toString("hex");
  const statusUnminted = await postHook(
    built,
    unmintedToken,
    stopBodyWithReason("reason-never-attributed"),
  );
  console.log(
    `hook-attribution: POST an unminted token -> ${statusUnminted} (expected 401)`,
  );
  if (statusUnminted !== 401) {
    violations.push(
      `unminted token: POST returned ${statusUnminted}, expected 401`,
    );
  }

  await killAndWait(built.server?.child);
  const card = readCard(built.dbPath, built.cardId);
  if (!card) {
    violations.push(
      `card ${built.cardId} missing from persisted board.db after kill`,
    );
    return violations;
  }

  const sessions = Array.isArray(card.sessions) ? card.sessions : [];
  console.log(
    `hook-attribution: persisted session count = ${sessions.length} (expected 2)`,
  );
  if (sessions.length !== 2) {
    violations.push(
      `card ${built.cardId}: expected exactly 2 persisted session records, found ${sessions.length}`,
    );
  }

  const expectedReasonBySessionId = new Map([
    [built.sessionA.id, reasonA],
    [built.sessionB.id, reasonB],
  ]);

  for (const [sessionId, expectedReason] of expectedReasonBySessionId) {
    const expectedMarkerKey = `NEEDS_INPUT ${expectedReason}`;
    const session = sessions.find((s) => s.id === sessionId);
    if (!session) {
      violations.push(
        `session ${sessionId}: not found in persisted sessions[]`,
      );
      continue;
    }
    const actualMarker = session.lastMarker;
    if (actualMarker === expectedMarkerKey) {
      console.log(
        `hook-attribution: PASS session ${sessionId} lastMarker = "${actualMarker}"`,
      );
    } else {
      const crossMatch = [...expectedReasonBySessionId.entries()].find(
        ([otherId, otherReason]) =>
          otherId !== sessionId &&
          actualMarker === `NEEDS_INPUT ${otherReason}`,
      );
      const crossNote = crossMatch
        ? ` — matches session ${crossMatch[0]}'s expected marker instead (cross-attribution)`
        : "";
      violations.push(
        `session ${sessionId}: lastMarker expected "${expectedMarkerKey}", actual "${actualMarker}"${crossNote}`,
      );
    }
    if (session.hookRoutedAt == null) {
      violations.push(
        `session ${sessionId}: hookRoutedAt is undefined, expected a timestamp`,
      );
    } else {
      console.log(
        `hook-attribution: PASS session ${sessionId} hookRoutedAt = "${session.hookRoutedAt}"`,
      );
    }
  }

  if (
    typeof card.activeSessionId !== "string" ||
    !sessions.some((s) => s.id === card.activeSessionId)
  ) {
    violations.push(
      `card ${built.cardId}: activeSessionId "${card.activeSessionId}" does not name a persisted session`,
    );
  } else {
    console.log(
      `hook-attribution: PASS activeSessionId "${card.activeSessionId}" still names a persisted session`,
    );
  }

  const hooksLogLines = (built.server?.logLines ?? []).filter((l) =>
    l.includes("[hooks]"),
  );
  for (const line of hooksLogLines) {
    console.log(`hook-attribution: server log: ${line}`);
  }

  return violations;
}

/**
 * One kill direction of the real-detector liveness proof (WATCH-01/C2, Task 1). Kills exactly
 * ONE real tmux session by name and polls — this file never calls the store's own per-session
 * lost-clearing method directly and never imports the store, so the ONLY thing that can ever
 * clear a session's fields here is the real 3-strike capture-failure detector on its real
 * self-rescheduling tick. Samples the wire's `sessionLost` on EVERY poll — not only the terminal
 * read — so a transient `true` is a violation even when the final read looks clean.
 * @remarks `kind === "active"` kills the card's ACTIVE session (A) and polls the WIRE for the
 * promotion (`activeSession.tmuxSession` becoming B's) — the wire is enough because the
 * promoted-to session is, by definition, the new active one. `kind === "sibling"` kills the
 * NON-active session (B) and polls the PERSISTED record directly instead, because the wire's
 * `redactCard` projection never exposes a non-active session's own fields — the active pointer
 * never moves in this direction, so there is no wire signal to poll for a clear.
 * @remarks On a timeout (the detector never fired within the poll budget), this still falls
 * through to the final persisted-state assertions below rather than returning early — a
 * regression that clears the WRONG session's fields (Task 3's Break A) needs those assertions to
 * run so the report names which session's fields actually disappeared, not just "timed out".
 */
async function checkLivenessDirection(kind) {
  return withFixture(`liveness-${kind}`, async (built) => {
    const violations = [];
    const dying = kind === "active" ? built.sessionA : built.sessionB;
    const surviving = kind === "active" ? built.sessionB : built.sessionA;
    const dyingTmux = kind === "active" ? built.tmux.a : built.tmux.b;
    const survivingTmux = kind === "active" ? built.tmux.b : built.tmux.a;

    const start = Date.now();
    await tmuxKillSession(dyingTmux);
    console.log(
      `liveness (${kind}): killed real tmux session ${dyingTmux} (session ${dying.id}) — waiting for the real 3-strike detector`,
    );

    let sawSessionLostTrue = false;
    let lastWireCard;
    let transitioned = false;
    const deadline = Date.now() + LIVENESS_POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      lastWireCard = await fetchFixtureCard(built);
      if (lastWireCard?.sessionLost === true) sawSessionLostTrue = true;
      if (kind === "active") {
        transitioned =
          lastWireCard?.activeSession?.tmuxSession === survivingTmux;
      } else {
        let persisted;
        try {
          persisted = readCard(built.dbPath, built.cardId);
        } catch {
          persisted = undefined;
        }
        const target = persisted?.sessions?.find((s) => s.id === dying.id);
        transitioned = target != null && target.tmuxSession == null;
      }
      if (transitioned) break;
      await sleep(LIVENESS_POLL_INTERVAL_MS);
    }
    const elapsedMs = Date.now() - start;
    console.log(
      `liveness (${kind}): transitioned=${transitioned} elapsedMs=${elapsedMs}`,
    );

    if (!transitioned) {
      violations.push(
        `liveness (${kind}): the real 3-strike detector did not clear session ${dying.id} within ${LIVENESS_POLL_TIMEOUT_MS}ms`,
      );
    } else if (elapsedMs < LIVENESS_MIN_ELAPSED_MS) {
      violations.push(
        `liveness (${kind}): transition observed after only ${elapsedMs}ms — faster than the real 2000ms tick / 3-strike detector could ` +
          `produce (floor ${LIVENESS_MIN_ELAPSED_MS}ms); this did not come from the real detector`,
      );
    }
    if (sawSessionLostTrue) {
      violations.push(
        `liveness (${kind}): wire sessionLost was observed true at least once while a live sibling still answered — ` +
          `a card must never render "Session lost" while a sibling is live`,
      );
    }

    if (kind === "active") {
      if (lastWireCard?.sessionCount !== 2) {
        violations.push(
          `liveness (${kind}): wire sessionCount expected 2, actual ${lastWireCard?.sessionCount}`,
        );
      }
      if (lastWireCard?.activeSession?.ttydPort !== built.ttyd.b.port) {
        violations.push(
          `liveness (${kind}): wire activeSession.ttydPort expected ${built.ttyd.b.port} (survivor's port), actual ${lastWireCard?.activeSession?.ttydPort}`,
        );
      }
    } else {
      if (lastWireCard?.activeSession?.id !== surviving.id) {
        violations.push(
          `liveness (${kind}): wire activeSession.id expected the untouched active session ${surviving.id}, actual ${lastWireCard?.activeSession?.id}`,
        );
      }
      if (lastWireCard?.activeSession?.tmuxSession !== survivingTmux) {
        violations.push(
          `liveness (${kind}): wire activeSession.tmuxSession expected the untouched ${survivingTmux}, actual ${lastWireCard?.activeSession?.tmuxSession}`,
        );
      }
    }

    await killAndWait(built.server?.child);
    const persisted = readCard(built.dbPath, built.cardId);
    if (!persisted) {
      violations.push(
        `liveness (${kind}): card ${built.cardId} missing from persisted board.db after kill`,
      );
      return violations;
    }
    const dyingRecord = persisted.sessions?.find((s) => s.id === dying.id);
    const survivingRecord = persisted.sessions?.find(
      (s) => s.id === surviving.id,
    );
    if (!dyingRecord) {
      violations.push(
        `liveness (${kind}): dying session ${dying.id} missing from persisted sessions[]`,
      );
    } else {
      for (const field of ["tmuxSession", "ttydPort", "hookToken"]) {
        if (dyingRecord[field] !== undefined) {
          violations.push(
            `liveness (${kind}): session ${dying.id} persisted ${field} expected absent, actual ${JSON.stringify(dyingRecord[field])}`,
          );
        } else {
          console.log(
            `liveness (${kind}): PASS session ${dying.id} persisted ${field} is absent`,
          );
        }
      }
    }
    if (!survivingRecord) {
      violations.push(
        `liveness (${kind}): surviving session ${surviving.id} missing from persisted sessions[]`,
      );
    } else {
      const expected =
        kind === "active"
          ? {
              tmuxSession: built.tmux.b,
              ttydPort: built.ttyd.b.port,
              hookToken: built.sessionB.token,
            }
          : {
              tmuxSession: built.tmux.a,
              ttydPort: built.ttyd.a.port,
              hookToken: built.sessionA.token,
            };
      for (const [field, expectedValue] of Object.entries(expected)) {
        if (survivingRecord[field] !== expectedValue) {
          violations.push(
            `liveness (${kind}): session ${surviving.id} persisted ${field} expected ${JSON.stringify(expectedValue)}, actual ${JSON.stringify(survivingRecord[field])}`,
          );
        } else {
          console.log(
            `liveness (${kind}): PASS session ${surviving.id} persisted ${field} = ${JSON.stringify(expectedValue)}`,
          );
        }
      }
    }
    if (persisted.activeSessionId !== surviving.id) {
      violations.push(
        `liveness (${kind}): persisted activeSessionId expected ${surviving.id}, actual ${persisted.activeSessionId}`,
      );
    } else {
      console.log(
        `liveness (${kind}): PASS persisted activeSessionId = ${persisted.activeSessionId}`,
      );
    }

    return violations;
  });
}

/**
 * `--check liveness` (WATCH-01/C2, Task 1): both real kill directions, each its own rebuilt
 * fixture. Neither this function nor any other in this file calls the store's own per-session
 * lost-clearing method or imports the store — the only path that clears a session here is a real
 * tmux kill plus the real 2000 ms-tick, 3-strike detector.
 */
async function checkLiveness() {
  const violations = [];
  violations.push(...(await checkLivenessDirection("active")));
  violations.push(...(await checkLivenessDirection("sibling")));
  return violations;
}

/**
 * Reconcile stage 1 (RECON-01/C3, Task 2): both sessions live across a real backend restart.
 * Records each ttyd port's listening PID with the repo's own `lsof -Fpn` port→PID technique
 * BEFORE the restart, restarts the sandbox server on the SAME home, and asserts each port is
 * still LISTENING held by the IDENTICAL PID — a different PID means a respawn, never the
 * adoption this criterion is about. Then proves the per-session token re-registration by
 * ATTRIBUTION, not by counting log lines: POST through each session's own token after the
 * restart and confirm, via a persisted readOnly re-read, that each POST's marker landed on its
 * own session's record.
 */
async function checkReconcileStage1(built) {
  const violations = [];
  const pidBeforeA = (await pidsListeningOnPort(built.ttyd.a.port))[0];
  const pidBeforeB = (await pidsListeningOnPort(built.ttyd.b.port))[0];
  console.log(
    `reconcile stage1: before restart — port ${built.ttyd.a.port} (A) pid=${pidBeforeA}, port ${built.ttyd.b.port} (B) pid=${pidBeforeB}`,
  );
  if (pidBeforeA == null || pidBeforeB == null) {
    violations.push(
      `reconcile stage1: could not resolve a pre-restart lsof PID for both ttyd ports`,
    );
    return violations;
  }

  await restartServer(built);

  const pidAfterA = (await pidsListeningOnPort(built.ttyd.a.port))[0];
  const pidAfterB = (await pidsListeningOnPort(built.ttyd.b.port))[0];
  console.log(
    `reconcile stage1: after restart — port ${built.ttyd.a.port} (A) pid=${pidAfterA}, port ${built.ttyd.b.port} (B) pid=${pidAfterB}`,
  );
  if (pidAfterA !== pidBeforeA) {
    violations.push(
      `reconcile stage1: session A's port ${built.ttyd.a.port} lsof PID changed across restart — before=${pidBeforeA} after=${pidAfterA} (a respawn, not an adoption)`,
    );
  }
  if (pidAfterB !== pidBeforeB) {
    violations.push(
      `reconcile stage1: session B's port ${built.ttyd.b.port} lsof PID changed across restart — before=${pidBeforeB} after=${pidAfterB} (a respawn, not an adoption)`,
    );
  }

  const reconcileLines = (built.server?.logLines ?? []).filter((l) =>
    l.includes("[reconcile]"),
  );
  for (const line of reconcileLines)
    console.log(`reconcile stage1: server log: ${line}`);
  const adoptedMatch = reconcileLines
    .map((l) => l.match(/ttyd adopted: (\d+)/))
    .find((m) => m);
  const adoptedCount = adoptedMatch ? Number(adoptedMatch[1]) : undefined;
  if (adoptedCount !== 2) {
    violations.push(
      `reconcile stage1: [reconcile] boot line reported ttyd adopted=${adoptedCount}, expected 2`,
    );
  }

  const reasonA = "reconcile-stage1-reason-A";
  const reasonB = "reconcile-stage1-reason-B";
  const statusA = await postHook(
    built,
    built.sessionA.token,
    stopBodyWithReason(reasonA),
  );
  const statusB = await postHook(
    built,
    built.sessionB.token,
    stopBodyWithReason(reasonB),
  );
  console.log(
    `reconcile stage1: POST session ${built.sessionA.id} (token A) -> ${statusA}; POST session ${built.sessionB.id} (token B) -> ${statusB}`,
  );
  if (statusA !== 204) {
    violations.push(
      `reconcile stage1: session ${built.sessionA.id}'s own token POSTed ${statusA}, expected 204`,
    );
  }
  if (statusB !== 204) {
    violations.push(
      `reconcile stage1: session ${built.sessionB.id}'s own token POSTed ${statusB}, expected 204`,
    );
  }

  await killAndWait(built.server?.child);
  const persisted = readCard(built.dbPath, built.cardId);
  const expectedReasonBySessionId = new Map([
    [built.sessionA.id, reasonA],
    [built.sessionB.id, reasonB],
  ]);
  for (const [sessionId, reason] of expectedReasonBySessionId) {
    const expectedMarkerKey = `NEEDS_INPUT ${reason}`;
    const record = persisted?.sessions?.find((s) => s.id === sessionId);
    if (!record) {
      violations.push(
        `reconcile stage1: session ${sessionId} missing from persisted sessions[] after restart`,
      );
      continue;
    }
    if (record.lastMarker !== expectedMarkerKey) {
      violations.push(
        `reconcile stage1: session ${sessionId} persisted lastMarker expected "${expectedMarkerKey}", actual "${record.lastMarker}"`,
      );
    } else {
      console.log(
        `reconcile stage1: PASS session ${sessionId} lastMarker = "${record.lastMarker}"`,
      );
    }
  }

  return violations;
}

/**
 * Reconcile stage 2 (RECON-01/C3, Task 2): one session already dead BEFORE a backend restart —
 * boot reconcile is the subject here, never the 3-strike detector (`bootstrap/index.ts` awaits
 * the sweep to completion before it ever starts listening, so there is no watcher wait to budget:
 * the assertions below run on the FIRST post-restart read). Kills tmux session A and its real
 * ttyd child directly — a truly dead session, not merely a dead pane — restarts the sandbox
 * server, and asserts B's port survives on the same PID, A's record is cleared, the wire's
 * `sessionLost` is falsy, `activeSessionId` still names a live session, and `sessionCount` stays
 * 2 (a lost session's record is cleared in place, never removed).
 */
async function checkReconcileStage2(built) {
  const violations = [];
  const pidBeforeB = (await pidsListeningOnPort(built.ttyd.b.port))[0];
  console.log(
    `reconcile stage2: before restart — port ${built.ttyd.b.port} (B) pid=${pidBeforeB}`,
  );

  await tmuxKillSession(built.tmux.a);
  try {
    built.ttyd.a.child.kill("SIGTERM");
  } catch {
    // already gone
  }
  await sleep(300);
  if (await isPortListening(built.ttyd.a.port)) {
    for (const pid of await pidsListeningOnPort(built.ttyd.a.port)) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // already gone
      }
    }
  }
  console.log(
    `reconcile stage2: killed real tmux session ${built.tmux.a} and its ttyd (session ${built.sessionA.id})`,
  );

  await restartServer(built);

  const pidAfterB = (await pidsListeningOnPort(built.ttyd.b.port))[0];
  console.log(
    `reconcile stage2: after restart — port ${built.ttyd.b.port} (B) pid=${pidAfterB}`,
  );
  if (pidBeforeB == null) {
    violations.push(
      `reconcile stage2: could not resolve a pre-restart lsof PID for B's port`,
    );
  } else if (pidAfterB !== pidBeforeB) {
    violations.push(
      `reconcile stage2: session B's port ${built.ttyd.b.port} lsof PID changed across restart — before=${pidBeforeB} after=${pidAfterB}`,
    );
  }

  const card = await fetchFixtureCard(built);
  console.log(
    `reconcile stage2: wire sessionLost=${card?.sessionLost}, sessionCount=${card?.sessionCount}, activeSession.id=${card?.activeSession?.id}`,
  );
  if (card?.sessionLost === true) {
    violations.push(
      `reconcile stage2: wire sessionLost is true — a live sibling must keep the card off "Session lost"`,
    );
  }
  if (card?.sessionCount !== 2) {
    violations.push(
      `reconcile stage2: wire sessionCount expected 2, actual ${card?.sessionCount}`,
    );
  }
  if (card?.activeSession?.id !== built.sessionB.id) {
    violations.push(
      `reconcile stage2: wire activeSession.id expected the live session ${built.sessionB.id}, actual ${card?.activeSession?.id}`,
    );
  }

  await killAndWait(built.server?.child);
  const persisted = readCard(built.dbPath, built.cardId);
  const deadRecord = persisted?.sessions?.find(
    (s) => s.id === built.sessionA.id,
  );
  if (!deadRecord) {
    violations.push(
      `reconcile stage2: dead session ${built.sessionA.id} missing from persisted sessions[]`,
    );
  } else {
    for (const field of ["tmuxSession", "ttydPort", "hookToken"]) {
      if (deadRecord[field] !== undefined) {
        violations.push(
          `reconcile stage2: dead session ${built.sessionA.id} persisted ${field} expected absent, actual ${JSON.stringify(deadRecord[field])}`,
        );
      }
    }
  }
  if (persisted?.activeSessionId !== built.sessionB.id) {
    violations.push(
      `reconcile stage2: persisted activeSessionId expected ${built.sessionB.id}, actual ${persisted?.activeSessionId}`,
    );
  }

  return violations;
}

/**
 * `--check reconcile` (RECON-01/C3, Task 2): stage 1 (both sessions live across a restart) and
 * stage 2 (one already dead before the restart), each its own fresh fixture.
 */
async function checkReconcile() {
  const violations = [];
  violations.push(
    ...(await withFixture("reconcile-stage1", checkReconcileStage1)),
  );
  violations.push(
    ...(await withFixture("reconcile-stage2", checkReconcileStage2)),
  );
  return violations;
}

/**
 * Cross-session attention proof (UI-02/criterion 5, Task 1): "a ticket where ANY session needs
 * input reads as needing input, and stays that way while another session replies." Reads
 * `GET /api/board` — the identical wire the board and Orca both consume — between every step,
 * never a store-internal read, so this check is falsified by exactly the same signal a human
 * would see on screen.
 * @remarks Session B is deliberately the NON-active session (`built.sessionA` is the
 * `activeSessionId` per {@link standUpFixture}) — step 1 firing through the non-active sibling's
 * own token is what proves attention is not active-session-only. Step 2 (session A, the working
 * sibling, replies) is the cross-session gate under test: `flipBack`'s "any OTHER session still
 * needs input" clause (`board.store.ts`) must suppress the move. Step 3 (session B's OWN reply)
 * is the positive control the plan requires — without it, step 2 passing could mean flip-back is
 * broken outright rather than that the cross-session gate specifically works.
 */
async function checkAttention(built) {
  const violations = [];
  const reasonB = "attention-cross-session-reason-B";

  console.log(
    `attention: active session at standup = ${built.sessionA.id} (A); firing session = ${built.sessionB.id} (B, non-active)`,
  );

  const statusStopB = await postHook(
    built,
    built.sessionB.token,
    stopBodyWithReason(reasonB),
  );
  console.log(
    `attention: step 1 POST Stop/NEEDS_INPUT via session B (non-active) -> ${statusStopB} (expected 204)`,
  );
  if (statusStopB !== 204) {
    violations.push(
      `step 1: POST Stop via session B returned ${statusStopB}, expected 204`,
    );
  }
  let card = await fetchFixtureCard(built);
  console.log(
    `attention: step 1 card.column = ${card?.column} (expected needs_input)`,
  );
  if (card?.column !== "needs_input") {
    violations.push(
      `step 1: card.column expected "needs_input" after session B's (non-active) NEEDS_INPUT marker, actual "${card?.column}"`,
    );
  }

  const statusPromptA = await postPromptSubmit(built, built.sessionA.token);
  console.log(
    `attention: step 2 POST UserPromptSubmit via session A (active, working sibling replying) -> ${statusPromptA} (expected 204)`,
  );
  if (statusPromptA !== 204) {
    violations.push(
      `step 2: POST UserPromptSubmit via session A returned ${statusPromptA}, expected 204`,
    );
  }
  card = await fetchFixtureCard(built);
  console.log(
    `attention: step 2 card.column = ${card?.column} (expected still needs_input — B still holds its marker)`,
  );
  if (card?.column !== "needs_input") {
    violations.push(
      `step 2: card.column expected to REMAIN "needs_input" after A's reply (session B still holds a needs-input marker), actual "${card?.column}" — a card that flipped here would read as answered while B is still blocked`,
    );
  }

  const statusPromptB = await postPromptSubmit(built, built.sessionB.token);
  console.log(
    `attention: step 3 POST UserPromptSubmit via session B (its own reply, positive control) -> ${statusPromptB} (expected 204)`,
  );
  if (statusPromptB !== 204) {
    violations.push(
      `step 3: POST UserPromptSubmit via session B returned ${statusPromptB}, expected 204`,
    );
  }
  card = await fetchFixtureCard(built);
  console.log(
    `attention: step 3 card.column = ${card?.column} (expected in_progress)`,
  );
  if (card?.column !== "in_progress") {
    violations.push(
      `step 3: card.column expected "in_progress" after session B's own reply, actual "${card?.column}" — without this passing, step 2 could be passing because flip-back is broken outright rather than because the cross-session gate works`,
    );
  }

  await killAndWait(built.server?.child);
  const persisted = readCard(built.dbPath, built.cardId);
  if (!persisted) {
    violations.push(
      `step 4: card ${built.cardId} missing from persisted board.db after kill`,
    );
    return violations;
  }
  const recordA = persisted.sessions?.find((s) => s.id === built.sessionA.id);
  const recordB = persisted.sessions?.find((s) => s.id === built.sessionB.id);
  const expectedMarkerKeyB = `NEEDS_INPUT ${reasonB}`;
  console.log(
    `attention: step 4 persisted session A (${built.sessionA.id}) lastMarker = ${JSON.stringify(recordA?.lastMarker)}`,
  );
  console.log(
    `attention: step 4 persisted session B (${built.sessionB.id}) lastMarker = ${JSON.stringify(recordB?.lastMarker)}`,
  );
  if (recordB?.lastMarker !== expectedMarkerKeyB) {
    violations.push(
      `step 4: session B persisted lastMarker expected "${expectedMarkerKeyB}" (FLOW-05: flipping out of needs_input leaves lastMarker untouched), actual "${recordB?.lastMarker}"`,
    );
  }
  if (recordA?.lastMarker !== undefined) {
    violations.push(
      `step 4: session A persisted lastMarker expected undefined (A never posted a marker), actual "${recordA?.lastMarker}" — the dedup key stayed per-session while the column stayed card-level`,
    );
  }

  return violations;
}

/**
 * Kill one real tmux session plus its real ttyd child and wait out the REAL 3-strike
 * capture-failure detector, resolving the elapsed milliseconds. Never calls a store mutator and
 * never imports the store — the only thing that can clear the session's fields here is
 * `watcher.ts`'s own detector on its own self-rescheduling tick, which is what makes a check
 * built on this falsifiable rather than self-fulfilling. Resolves `null` if the detector never
 * fired inside {@link LIVENESS_POLL_TIMEOUT_MS}, so the caller reports a timeout as its own named
 * violation instead of hanging.
 */
async function killSessionAndAwaitDetector(
  built,
  tmuxName,
  ttydEntry,
  sessionId,
) {
  const start = Date.now();
  await tmuxKillSession(tmuxName);
  if (ttydEntry?.child) {
    try {
      ttydEntry.child.kill("SIGTERM");
    } catch {
      // already gone
    }
  }
  const deadline = Date.now() + LIVENESS_POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    let persisted;
    try {
      persisted = readCard(built.dbPath, built.cardId);
    } catch {
      persisted = undefined;
    }
    const record = persisted?.sessions?.find((s) => s.id === sessionId);
    if (record != null && record.tmuxSession == null) return Date.now() - start;
    await sleep(LIVENESS_POLL_INTERVAL_MS);
  }
  return null;
}

/**
 * Cross-session attention proof, DEAD-sibling direction (CR-01). {@link checkAttention} proves the
 * gate HOLDS while the sibling that fired the marker is still live; this proves the gate RELEASES
 * once that sibling can no longer answer. The distinction is the whole correctness property: the
 * gate exists so a ticket where any session needs input reads as needing input, and a session
 * whose tmux pane is gone is definitionally not waiting on the user, so leaving it able to
 * suppress the move makes `needs_input` a one-way latch no code path can ever clear.
 * @remarks Session B (non-active) fires the marker and is then really killed — tmux session and
 * ttyd child both — and the REAL 3-strike detector, never a store call from this file, is what
 * clears its `tmuxSession`. Session A (active, still live) then replies through its own token.
 * Step 3 is the falsifiable subject: a card still reading `needs_input` there is a user-visible
 * permanent freeze, because every later reply repeats the identical suppression.
 * @remarks Step 4 reads the PERSISTED record rather than the wire because `redactCard` never
 * projects a non-active sibling's own fields — B's cleared `lastMarker` is only observable there.
 */
async function checkAttentionDeadSibling(built) {
  const violations = [];
  const reasonB = "attention-dead-sibling-reason-B";

  console.log(
    `attention-dead-sibling: active session = ${built.sessionA.id} (A, stays live); firing-then-dying session = ${built.sessionB.id} (B, non-active)`,
  );

  const statusStopB = await postHook(
    built,
    built.sessionB.token,
    stopBodyWithReason(reasonB),
  );
  console.log(
    `attention-dead-sibling: step 1 POST Stop/NEEDS_INPUT via session B -> ${statusStopB} (expected 204)`,
  );
  if (statusStopB !== 204) {
    violations.push(
      `step 1: POST Stop via session B returned ${statusStopB}, expected 204`,
    );
  }
  let card = await fetchFixtureCard(built);
  console.log(
    `attention-dead-sibling: step 1 card.column = ${card?.column} (expected needs_input)`,
  );
  if (card?.column !== "needs_input") {
    violations.push(
      `step 1: card.column expected "needs_input" after session B's NEEDS_INPUT marker, actual "${card?.column}"`,
    );
  }

  const elapsedMs = await killSessionAndAwaitDetector(
    built,
    built.tmux.b,
    built.ttyd.b,
    built.sessionB.id,
  );
  console.log(
    `attention-dead-sibling: step 2 killed real tmux ${built.tmux.b} + its ttyd; detector cleared session B after elapsedMs=${elapsedMs}`,
  );
  if (elapsedMs == null) {
    violations.push(
      `step 2: the real 3-strike detector did not clear session ${built.sessionB.id} within ${LIVENESS_POLL_TIMEOUT_MS}ms`,
    );
  } else if (elapsedMs < LIVENESS_MIN_ELAPSED_MS) {
    violations.push(
      `step 2: session ${built.sessionB.id} cleared after only ${elapsedMs}ms — faster than the real 2000ms tick / 3-strike detector could produce (floor ${LIVENESS_MIN_ELAPSED_MS}ms)`,
    );
  }
  card = await fetchFixtureCard(built);
  console.log(
    `attention-dead-sibling: step 2 wire sessionLost=${card?.sessionLost} (expected falsy — A is still live), column=${card?.column} (expected still needs_input)`,
  );
  if (card?.sessionLost === true) {
    violations.push(
      `step 2: wire sessionLost is true while session A is still live — a card must never render "Session lost" with a live sibling`,
    );
  }
  if (card?.column !== "needs_input") {
    violations.push(
      `step 2: card.column expected to REMAIN "needs_input" after B merely died (nobody has replied yet), actual "${card?.column}"`,
    );
  }

  const statusPromptA = await postPromptSubmit(built, built.sessionA.token);
  console.log(
    `attention-dead-sibling: step 3 POST UserPromptSubmit via session A (live, the only session that can still answer) -> ${statusPromptA} (expected 204)`,
  );
  if (statusPromptA !== 204) {
    violations.push(
      `step 3: POST UserPromptSubmit via session A returned ${statusPromptA}, expected 204`,
    );
  }
  card = await fetchFixtureCard(built);
  console.log(
    `attention-dead-sibling: step 3 card.column = ${card?.column} (expected in_progress)`,
  );
  if (card?.column !== "in_progress") {
    violations.push(
      `step 3: card.column expected "in_progress" after the live session A replied, actual "${card?.column}" — the dead session B still holds a NEEDS_INPUT marker no code path can clear, so the card is frozen in Needs Input permanently and every later reply repeats this suppression`,
    );
  }

  await killAndWait(built.server?.child);
  const persisted = readCard(built.dbPath, built.cardId);
  if (!persisted) {
    violations.push(
      `step 4: card ${built.cardId} missing from persisted board.db after kill`,
    );
    return violations;
  }
  const recordB = persisted.sessions?.find((s) => s.id === built.sessionB.id);
  console.log(
    `attention-dead-sibling: step 4 persisted session B (${built.sessionB.id}) tmuxSession=${JSON.stringify(recordB?.tmuxSession)} lastMarker=${JSON.stringify(recordB?.lastMarker)}`,
  );
  if (!recordB) {
    violations.push(
      `step 4: session ${built.sessionB.id} missing from persisted sessions[]`,
    );
  } else {
    if (recordB.tmuxSession !== undefined) {
      violations.push(
        `step 4: dead session ${built.sessionB.id} persisted tmuxSession expected absent, actual ${JSON.stringify(recordB.tmuxSession)}`,
      );
    }
    if (recordB.lastMarker !== undefined) {
      violations.push(
        `step 4: dead session ${built.sessionB.id} persisted lastMarker expected absent — a session whose tmux pane is gone cannot be waiting on the user, so its needs-input key must not survive the loss, actual ${JSON.stringify(recordB.lastMarker)}`,
      );
    }
  }

  return violations;
}

/**
 * Single-session (N=1) parity proof, on a card owning EXACTLY ONE session record: marker routing,
 * flip-back, session-lost detection, and the unseen-activity dot's precondition. Promoted verbatim
 * in substance from the scratch script Phase 91 settled this leg with and never committed — the
 * claim it made was unrepeatable by anyone, including its own verifier, which is the failure mode
 * this mode exists to close. Only the duplicated scaffolding was dropped: it now runs inside this
 * harness's own envelope ({@link assertNoLiveService}, {@link assertSandboxSafe}, the sandbox home,
 * the compile-first {@link assertBuilt}) on {@link SINGLE_SESSION_FIXTURE}'s own port and tmux
 * namespace.
 *
 * Every OTHER check here seeds two sessions, which is exactly why this leg needs its own fixture:
 * at N=1 the cross-session gates have no sibling to bind against, so they are structurally
 * unreachable rather than merely unexercised, and that is the shape almost every real dispatch
 * ticket has.
 *
 * @remarks Step 1 asserts `sessionCount` is ABSENT from the wire, not that it equals 1:
 * `redactCard` emits it only at `>= 2` so a single-session card renders no session-count suffix at
 * all. That absence is the parity claim — an N=1 card must look exactly like a pre-entity card.
 * @remarks Step 2's flip-back is the positive control that `flipBack` still moves an N=1 card:
 * `checkAttention`'s cross-session gate (`s.id !== targetId`) can never fire here because the card
 * owns one session, so a card that fails to flip back at N=1 is broken outright.
 * @remarks Step 3 EXPECTS the wire's `sessionLost` to become true — the exact observation
 * {@link checkLivenessDirection} records as a VIOLATION, because there a live sibling still
 * answers. At N=1 every session the card owns is now dead, so the derived full loss is correct and
 * its absence would be the bug. The {@link LIVENESS_MIN_ELAPSED_MS} floor is what keeps this from
 * being satisfiable by anything other than the real 2000 ms-tick, 3-strike detector.
 * @remarks Step 4 reads the PERSISTED card after killing the server rather than the wire, because
 * `outputChangedAt` is a card-level field the Stop event in step 1 stamps and nothing in the
 * session-lost path clears (`markSessionLost` clears the artifact fields, never this one) — the
 * unseen-activity dot's precondition must survive the loss, or the dot could never be shown for a
 * card whose session has since died.
 */
async function checkSingleSession(built) {
  const violations = [];
  const only = built.sessionA;
  const reason = "single-session-parity-reason";
  console.log(
    `single-session: card ${built.cardId} owns exactly one session — ${only.id} on tmux ${built.tmux.a}, ttyd ${built.ttyd.a.port}`,
  );

  const statusStop = await postHook(
    built,
    only.token,
    stopBodyWithReason(reason),
  );
  console.log(
    `single-session: step 1 POST Stop/NEEDS_INPUT via the only session's own token -> ${statusStop} (expected 204)`,
  );
  if (statusStop !== 204) {
    violations.push(`step 1: POST Stop returned ${statusStop}, expected 204`);
  }
  let wire = await fetchFixtureCard(built);
  console.log(
    `single-session: step 1 wire card.column = ${wire?.column} (expected needs_input)`,
  );
  if (wire?.column !== "needs_input") {
    violations.push(
      `step 1: card.column expected "needs_input", actual "${wire?.column}"`,
    );
  }
  console.log(
    `single-session: step 1 wire card.sessionCount = ${wire?.sessionCount} (expected absent at N=1)`,
  );
  if (wire?.sessionCount !== undefined) {
    violations.push(
      `step 1: card.sessionCount expected undefined at N=1 (redactCard emits it only at >= 2, so a single-session card must render no session-count suffix), actual ${wire?.sessionCount}`,
    );
  }

  const statusPrompt = await postPromptSubmit(built, only.token);
  console.log(
    `single-session: step 2 POST UserPromptSubmit -> ${statusPrompt} (expected 204)`,
  );
  if (statusPrompt !== 204) {
    violations.push(
      `step 2: POST UserPromptSubmit returned ${statusPrompt}, expected 204`,
    );
  }
  wire = await fetchFixtureCard(built);
  console.log(
    `single-session: step 2 wire card.column = ${wire?.column} (expected in_progress — the cross-session gate has no sibling to bind against at N=1)`,
  );
  if (wire?.column !== "in_progress") {
    violations.push(
      `step 2: card.column expected "in_progress" after flip-back, actual "${wire?.column}"`,
    );
  }

  const killStart = Date.now();
  await tmuxKillSession(built.tmux.a);
  console.log(
    `single-session: step 3 killed real tmux session ${built.tmux.a} — waiting for the real 3-strike detector`,
  );
  let sawLost = false;
  const deadline = Date.now() + LIVENESS_POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    wire = await fetchFixtureCard(built);
    if (wire?.sessionLost === true) {
      sawLost = true;
      break;
    }
    await sleep(LIVENESS_POLL_INTERVAL_MS);
  }
  const elapsedMs = Date.now() - killStart;
  console.log(
    `single-session: step 3 wire sessionLost observed true = ${sawLost}, elapsedMs=${elapsedMs} (floor ${LIVENESS_MIN_ELAPSED_MS}ms)`,
  );
  if (!sawLost) {
    violations.push(
      `step 3: the real 3-strike detector did not derive sessionLost=true within ${LIVENESS_POLL_TIMEOUT_MS}ms — at N=1 every session the card owns is dead, so a card that never reads "Session lost" strands the user with no restart affordance`,
    );
  } else if (elapsedMs < LIVENESS_MIN_ELAPSED_MS) {
    violations.push(
      `step 3: sessionLost observed after only ${elapsedMs}ms — faster than the real 2000ms tick / 3-strike detector could produce (floor ${LIVENESS_MIN_ELAPSED_MS}ms); this did not come from the real detector`,
    );
  }

  await killAndWait(built.server?.child);
  const persisted = readCard(built.dbPath, built.cardId);
  if (!persisted) {
    violations.push(
      `step 4: card ${built.cardId} missing from persisted board.db after kill`,
    );
    return violations;
  }
  console.log(
    `single-session: step 4 persisted card.outputChangedAt = ${persisted.outputChangedAt} (expected a timestamp, stamped by step 1's Stop event)`,
  );
  if (persisted.outputChangedAt == null) {
    violations.push(
      `step 4: outputChangedAt expected a timestamp stamped by step 1's Stop event, actual ${persisted.outputChangedAt} — without it the unseen-activity dot has no precondition to render from`,
    );
  }

  const record = persisted.sessions?.find((s) => s.id === only.id);
  console.log(
    `single-session: step 5 persisted session ${only.id} tmuxSession = ${JSON.stringify(record?.tmuxSession)} (expected absent); card.tmuxSession = ${JSON.stringify(persisted.tmuxSession)} (expected absent)`,
  );
  if (!record) {
    violations.push(
      `step 5: session ${only.id} missing from persisted sessions[]`,
    );
  } else if (record.tmuxSession !== undefined) {
    violations.push(
      `step 5: session ${only.id} persisted tmuxSession expected absent, actual ${JSON.stringify(record.tmuxSession)}`,
    );
  }
  if (persisted.tmuxSession !== undefined) {
    violations.push(
      `step 5: card-level tmuxSession expected absent, actual ${JSON.stringify(persisted.tmuxSession)} — at N=1 the lost session IS the active one, so setActiveSession's flat mirror must clear with it or an older build reads a live session that is gone`,
    );
  }

  return violations;
}

/**
 * Speak ttyd's actual wire protocol over the reverse-proxy WS upgrade path and accumulate the pane
 * bytes it streams back — the only way to prove `resolveLiveTtydPort`'s per-session routing reaches
 * a REAL pane, since a bare GET through the proxy serves dispatch's own static bundle and never
 * touches ttyd (`92-RESEARCH.md` `## 6`). Protocol read directly from `src/web/terminal-main.ts`
 * (read-only reference; `NEW-20` fences editing that file, not reading it): the `"tty"` sub-protocol,
 * an un-prefixed JSON handshake, and server frames prefixed `0x30` (OUTPUT, pty bytes follow) or
 * `0x31` (TITLE, ignored).
 *
 * Deliberately reports observation only, never a pass/fail verdict: resolving `{ text, opened,
 * closeCode }` in every outcome (marker found, timeout, or the socket itself closing/erroring) is
 * what lets the CALLING check distinguish "never connected" from "connected but read the wrong
 * content" — collapsing those into a boolean here would erase exactly the distinction Task 2's two
 * proof-of-failure breaks depend on.
 */
async function readPaneThroughProxy({ port, idSegment, expect, timeoutMs }) {
  return new Promise((resolve) => {
    let opened = false;
    let closeCode = null;
    let text = "";
    let settled = false;
    const url = `ws://127.0.0.1:${port}/sessions/${idSegment}/terminal/ws`;
    const ws = new WebSocket(url, ["tty"]);
    ws.binaryType = "arraybuffer";
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        // already closing/closed
      }
      resolve({ text, opened, closeCode });
    };
    const timer = setTimeout(finish, timeoutMs);
    ws.addEventListener("open", () => {
      opened = true;
      ws.send(JSON.stringify({ AuthToken: "", columns: 120, rows: 40 }));
    });
    ws.addEventListener("message", (event) => {
      const buf = Buffer.from(event.data);
      if (buf.length === 0) return;
      const prefix = buf[0];
      if (prefix === 0x31) return;
      if (prefix === 0x30) {
        text += buf.subarray(1).toString("utf8");
        if (expect && text.includes(expect)) finish();
      }
    });
    ws.addEventListener("close", (event) => {
      closeCode = event.code;
      finish();
    });
    ws.addEventListener("error", finish);
  });
}

/**
 * Open one WS against `url`, offering `protocols` verbatim (`undefined` = offer none), and report
 * whether the upgrade completed. Used only by {@link probeSubprotocolAcceptance} to settle
 * `92-RESEARCH.md` assumption A2 — never wired into a pass/fail check, since which subprotocol
 * shape a given ttyd build accepts is a finding to record, not a correctness claim this harness
 * asserts.
 */
async function probeOneConnection(url, protocols) {
  return new Promise((resolve) => {
    let opened = false;
    let protocol = null;
    let closeCode = null;
    let settled = false;
    const ws =
      protocols === undefined
        ? new WebSocket(url)
        : new WebSocket(url, protocols);
    ws.binaryType = "arraybuffer";
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        // already closing/closed
      }
      resolve({ opened, protocol, closeCode });
    };
    const timer = setTimeout(finish, SUBPROTOCOL_PROBE_TIMEOUT_MS);
    ws.addEventListener("open", () => {
      opened = true;
      protocol = ws.protocol;
      finish();
    });
    ws.addEventListener("close", (event) => {
      closeCode = event.code;
      finish();
    });
    ws.addEventListener("error", finish);
  });
}

/**
 * Settle `92-RESEARCH.md` assumption A2 by live connection attempt rather than by assumption:
 * one WS opened WITH the `"tty"` sub-protocol, one WITHOUT, both against the same URL. Logs which
 * shape(s) this installed ttyd 1.7.7 accepts so a future connection failure is diagnosed against a
 * recorded finding instead of misattributed to a routing bug. The shipped client always offers
 * `"tty"` (`terminal-main.ts:252`), so this harness keeps offering it regardless of what this probe
 * finds — the probe is informational, not a basis for changing what {@link readPaneThroughProxy}
 * sends. Addresses session A's OWN id (not `built.cardId`, which no longer resolves to any live
 * port once the proxy is session-keyed, PROXY-01) so the probe genuinely connects.
 */
async function probeSubprotocolAcceptance(built) {
  const url = `ws://127.0.0.1:${built.port}/sessions/${built.sessionA.id}/terminal/ws`;
  const withTty = await probeOneConnection(url, ["tty"]);
  const withoutProto = await probeOneConnection(url, undefined);
  console.log(
    `proxy-addressing: A2 subprotocol finding — WITH "tty": opened=${withTty.opened} ` +
      `negotiatedProtocol=${JSON.stringify(withTty.protocol)} closeCode=${withTty.closeCode}; ` +
      `WITHOUT: opened=${withoutProto.opened} negotiatedProtocol=${JSON.stringify(withoutProto.protocol)} ` +
      `closeCode=${withoutProto.closeCode}`,
  );
}

/**
 * `--check proxy-addressing` (PROXY-01, `92-VALIDATION.md` C1's actual isolation claim): write a
 * DISTINCT marker into each of the two real tmux panes, then read each back through its OWN
 * session-keyed proxy path (`built.sessionA.id` / `built.sessionB.id`) while BOTH sessions stay
 * live and neither the active pointer nor either session's tmux/ttyd is torn down between the two
 * reads — criterion 1 is about SIMULTANEOUS reachability, not sequential. Four assertions carry
 * the actual claim: A's path yields A's marker and not B's, B's path yields B's marker and not A's.
 * A fifth, weaker leg (`built.ttyd.a.port !== built.ttyd.b.port`) is recorded alongside but is
 * explicitly NOT the criterion — `92-CONTEXT.md` rejects "the ports differ" as proof, since the two
 * real ttyd backends are always on distinct kernel-assigned ports regardless of whether the
 * addressing logic under test is even correct (see the harness's own "wrong-subject" break, which
 * demonstrates this leg passing under a real routing regression).
 * @remarks Each marker embeds `built.port` and a random suffix so a stale pane left by an earlier,
 * imperfectly torn-down run can never satisfy a fresh run's expectation by accident.
 */
async function checkProxyAddressing(built) {
  const violations = [];
  await probeSubprotocolAcceptance(built);

  const markerA = `proxy-addressing-${built.port}-a-${randomBytes(4).toString("hex")}`;
  const markerB = `proxy-addressing-${built.port}-b-${randomBytes(4).toString("hex")}`;
  await writePaneMarker(built.tmux.a, built.home, markerA);
  await writePaneMarker(built.tmux.b, built.home, markerB);
  console.log(
    `proxy-addressing: wrote marker into pane ${built.tmux.a}: ${markerA}`,
  );
  console.log(
    `proxy-addressing: wrote marker into pane ${built.tmux.b}: ${markerB}`,
  );

  const resultA = await readPaneThroughProxy({
    port: built.port,
    idSegment: built.sessionA.id,
    expect: markerA,
    timeoutMs: PROXY_READ_TIMEOUT_MS,
  });
  console.log(
    `proxy-addressing: session A path (${built.sessionA.id}) — opened=${resultA.opened} ` +
      `closeCode=${resultA.closeCode} accumulatedChars=${resultA.text.length} ` +
      `containsA=${resultA.text.includes(markerA)} containsB=${resultA.text.includes(markerB)}`,
  );

  const resultB = await readPaneThroughProxy({
    port: built.port,
    idSegment: built.sessionB.id,
    expect: markerB,
    timeoutMs: PROXY_READ_TIMEOUT_MS,
  });
  console.log(
    `proxy-addressing: session B path (${built.sessionB.id}) — opened=${resultB.opened} ` +
      `closeCode=${resultB.closeCode} accumulatedChars=${resultB.text.length} ` +
      `containsA=${resultB.text.includes(markerA)} containsB=${resultB.text.includes(markerB)}`,
  );

  if (!resultA.opened) {
    violations.push(
      `proxy-addressing: session A's path never opened against ws://127.0.0.1:${built.port}/sessions/${built.sessionA.id}/terminal/ws ` +
        `(closeCode=${resultA.closeCode}) — expected marker "${markerA}"`,
    );
  } else {
    if (!resultA.text.includes(markerA)) {
      violations.push(
        `proxy-addressing: session A's path did not yield A's own marker "${markerA}" — ` +
          `accumulated ${resultA.text.length} chars: ${JSON.stringify(resultA.text.slice(-300))}`,
      );
    }
    if (resultA.text.includes(markerB)) {
      violations.push(
        `proxy-addressing: session A's path served session B's marker "${markerB}" — cross-served`,
      );
    }
  }

  if (!resultB.opened) {
    violations.push(
      `proxy-addressing: session B's path never opened against ws://127.0.0.1:${built.port}/sessions/${built.sessionB.id}/terminal/ws ` +
        `(closeCode=${resultB.closeCode}) — expected marker "${markerB}"`,
    );
  } else {
    if (!resultB.text.includes(markerB)) {
      violations.push(
        `proxy-addressing: session B's path did not yield B's own marker "${markerB}" — ` +
          `accumulated ${resultB.text.length} chars: ${JSON.stringify(resultB.text.slice(-300))}`,
      );
    }
    if (resultB.text.includes(markerA)) {
      violations.push(
        `proxy-addressing: session B's path served session A's marker "${markerA}" — cross-served`,
      );
    }
  }

  const portsDiffer = built.ttyd.a.port !== built.ttyd.b.port;
  console.log(
    `proxy-addressing: corroborating (NOT the criterion) — resolved ttyd ports differ: ${portsDiffer} ` +
      `(a=${built.ttyd.a.port}, b=${built.ttyd.b.port})`,
  );

  return violations;
}

/**
 * `--check orphan-sweep` (`TERM-05`, criterion 6): the sweep fingerprint is proven, not read from
 * the source. Plants a REAL ttyd carrying the pre-92 fingerprint ({@link spawnOrphanTtyd} — old
 * revision key, card-keyed base path), registers it as a THIRD persisted session record on the
 * fixture card (so its fate genuinely runs through `adoptAndSweep`'s `compatible` check rather than
 * the raw ps-scan fingerprint alone — see the in-body remark), then restarts the sandbox server
 * (which runs `reconcileSessions()`/`adoptAndSweep` unconditionally at boot, T-92-10) and asserts
 * BOTH directions in the SAME run:
 *   - SWEEP: the planted orphan's pid is gone after the restart.
 *   - SPARE: the fixture's own two ttyd — current revision, session-keyed base path, still attached
 *     to live fixture tmux sessions — keep the SAME lsof-resolved pid across the restart (re-adopted,
 *     not respawned, and certainly not swept) and still serve their own pane content through the
 *     proxy.
 * A check that only proved one direction would pass a build that sweeps indiscriminately (the spare
 * direction stays silent) or a build that sweeps nothing at all (the sweep direction stays silent) —
 * `92-03-PLAN.md`'s three named breaks exercise exactly these blind spots.
 * @remarks The planted orphan's tmux session and ttyd are registered onto `built.orphan` so
 * {@link tearDownFixture} reaps them the same way it reaps the fixture's own two sessions, even when
 * this function throws or returns early on a setup violation — a failed run must never leave a
 * stray ttyd behind.
 */
async function checkOrphanSweep(built) {
  const violations = [];

  const orphanTmuxName = `${built.tmuxPrefix}orphan`;
  await tmuxNewSession(orphanTmuxName, built.home);
  const orphan = await spawnOrphanTtyd(orphanTmuxName, built.cardId);
  built.orphan = {
    tmuxName: orphanTmuxName,
    child: orphan.child,
    port: orphan.port,
  };
  await waitForPortListening(orphan.port);

  const orphanPid = orphan.child.pid;
  const orphanAliveBefore = await isPortListening(orphan.port);
  const orphanPidAliveBefore = orphanPid != null && pidAlive(orphanPid);
  console.log(
    `orphan-sweep: planted orphan pid=${orphanPid} port=${orphan.port} tmux=${orphanTmuxName} ` +
      `fingerprint=pre-92 (DISPATCH_TTYD_REVISION_5, card-keyed -b) listening=${orphanAliveBefore} ` +
      `pidAlive=${orphanPidAliveBefore}`,
  );
  /**
   * Both the PORT and the exact PID identity are checked before the restart — not the port alone.
   * A check that only confirmed "something is listening on the orphan's port" could be pointed at
   * a pid that was never actually the spawned orphan (the wrong-subject break `92-03-PLAN.md`
   * names) and would still vacuously report success once that unrelated pid happened to already be
   * gone. Requiring `pidAlive(orphanPid)` to hold for the SAME pid this check later waits on is
   * what turns a swapped subject into a setup violation instead of a silent false pass.
   */
  if (orphanPid == null || !orphanAliveBefore || !orphanPidAliveBefore) {
    violations.push(
      `orphan-sweep: setup failure — planted orphan (pid=${orphanPid}) is not alive (port ` +
        `listening=${orphanAliveBefore}, pid alive=${orphanPidAliveBefore}) before the restart; ` +
        `this is a harness setup violation, not the sweep under test`,
    );
    return violations;
  }

  /**
   * `adoptAndSweep`'s `candidates` array (`reconcile.ts`) is built ONLY from
   * `store.sessionsWithTmux()` — a session record whose `tmuxSession` is live AND whose
   * `ttydPort` is set. A stray ttyd with no matching session record is never a candidate for
   * RE-ADOPTION at all — it is unconditionally swept via the raw `ps`-scan fingerprint regardless
   * of its OWN revision key, which would make the sweep-direction assertion below true no matter
   * whether the revision fingerprint narrows correctly (a dead instrument for criterion 6's actual
   * claim). Persisting the orphan as a THIRD session record on the fixture card — pointing at its
   * real tmux name and real port — is what makes its fate depend on `compatible`, the same way a
   * genuine pre-92 ttyd's fate would at a real upgrade boot.
   */
  const cardBeforePlant = readCard(built.dbPath, built.cardId);
  if (!cardBeforePlant) {
    violations.push(
      `orphan-sweep: setup failure — could not read the persisted fixture card ${built.cardId} ` +
        `before registering the planted orphan as a session candidate`,
    );
    return violations;
  }
  const orphanSessionId = randomUUID();
  const plantedAt = new Date().toISOString();
  cardBeforePlant.sessions = [
    ...cardBeforePlant.sessions,
    {
      id: orphanSessionId,
      createdAt: plantedAt,
      updatedAt: plantedAt,
      tmuxSession: orphanTmuxName,
      ttydPort: orphan.port,
      hookToken: randomBytes(32).toString("hex"),
      workspacePath: join(built.home, "workspaces", "SHL-1-orphan"),
    },
  ];
  seedFixtureCard(built.home, cardBeforePlant);
  console.log(
    `orphan-sweep: registered orphan as a THIRD persisted session ${orphanSessionId} — ` +
      `tmuxSession=${orphanTmuxName} ttydPort=${orphan.port}, so its fate now depends on ` +
      `\`compatible\`, not just the raw ps-scan fingerprint`,
  );

  const pidBeforeA = (await pidsListeningOnPort(built.ttyd.a.port))[0];
  const pidBeforeB = (await pidsListeningOnPort(built.ttyd.b.port))[0];
  console.log(
    `orphan-sweep: before restart — fixture A port ${built.ttyd.a.port} pid=${pidBeforeA}, ` +
      `fixture B port ${built.ttyd.b.port} pid=${pidBeforeB}`,
  );
  if (pidBeforeA == null || pidBeforeB == null) {
    violations.push(
      `orphan-sweep: SPARE DIRECTION FAILED — could not resolve a pre-restart lsof PID for both ` +
        `fixture ttyd ports (a=${pidBeforeA}, b=${pidBeforeB}) — the fixture's own ttyd are not both ` +
        `alive going into the restart, so the spare direction cannot be proven this run; the sweep ` +
        `direction is still exercised below on the planted orphan regardless`,
    );
  }

  await restartServer(built);

  const sweptWithinTimeout = await waitForPidGone(
    orphanPid,
    LISTEN_POLL_TIMEOUT_MS,
  );
  if (!sweptWithinTimeout) {
    const line = await psLineFor(orphanPid);
    violations.push(
      `orphan-sweep: SWEEP DIRECTION FAILED — planted orphan pid ${orphanPid} still alive ` +
        `${LISTEN_POLL_TIMEOUT_MS}ms after the boot restart, expected swept as incompatible ` +
        `(pre-92 fingerprint): ${line}`,
    );
  } else {
    console.log(
      `orphan-sweep: SWEEP DIRECTION — planted orphan pid ${orphanPid} confirmed gone after the ` +
        `restart's reconcileSessions()`,
    );
  }

  const pidAfterA = (await pidsListeningOnPort(built.ttyd.a.port))[0];
  const pidAfterB = (await pidsListeningOnPort(built.ttyd.b.port))[0];
  console.log(
    `orphan-sweep: after restart — fixture A port ${built.ttyd.a.port} pid=${pidAfterA}, ` +
      `fixture B port ${built.ttyd.b.port} pid=${pidAfterB}`,
  );
  if (pidBeforeA != null && pidAfterA !== pidBeforeA) {
    violations.push(
      `orphan-sweep: SPARE DIRECTION FAILED — fixture session A's port ${built.ttyd.a.port} lsof ` +
        `PID changed across restart — before=${pidBeforeA} after=${pidAfterA} (a spared ttyd must ` +
        `be RE-ADOPTED, not respawned, and definitely not swept)`,
    );
  }
  if (pidBeforeB != null && pidAfterB !== pidBeforeB) {
    violations.push(
      `orphan-sweep: SPARE DIRECTION FAILED — fixture session B's port ${built.ttyd.b.port} lsof ` +
        `PID changed across restart — before=${pidBeforeB} after=${pidAfterB} (a spared ttyd must ` +
        `be RE-ADOPTED, not respawned, and definitely not swept)`,
    );
  }

  const markerA = `orphan-sweep-${built.port}-a-${randomBytes(4).toString("hex")}`;
  const markerB = `orphan-sweep-${built.port}-b-${randomBytes(4).toString("hex")}`;
  await writePaneMarker(built.tmux.a, built.home, markerA);
  await writePaneMarker(built.tmux.b, built.home, markerB);

  const resultA = await readPaneThroughProxy({
    port: built.port,
    idSegment: built.sessionA.id,
    expect: markerA,
    timeoutMs: PROXY_READ_TIMEOUT_MS,
  });
  console.log(
    `orphan-sweep: spare direction content read — session A (${built.sessionA.id}) ` +
      `opened=${resultA.opened} containsOwn=${resultA.text.includes(markerA)}`,
  );
  if (!resultA.opened || !resultA.text.includes(markerA)) {
    violations.push(
      `orphan-sweep: SPARE DIRECTION FAILED — session A's proxy path did not yield its own marker ` +
        `"${markerA}" after the restart (opened=${resultA.opened}, closeCode=${resultA.closeCode})`,
    );
  }

  const resultB = await readPaneThroughProxy({
    port: built.port,
    idSegment: built.sessionB.id,
    expect: markerB,
    timeoutMs: PROXY_READ_TIMEOUT_MS,
  });
  console.log(
    `orphan-sweep: spare direction content read — session B (${built.sessionB.id}) ` +
      `opened=${resultB.opened} containsOwn=${resultB.text.includes(markerB)}`,
  );
  if (!resultB.opened || !resultB.text.includes(markerB)) {
    violations.push(
      `orphan-sweep: SPARE DIRECTION FAILED — session B's proxy path did not yield its own marker ` +
        `"${markerB}" after the restart (opened=${resultB.opened}, closeCode=${resultB.closeCode})`,
    );
  }

  return violations;
}

/**
 * Open a proxied WS exactly like {@link readPaneThroughProxy} (same URL shape, the `"tty"`
 * sub-protocol, the same un-prefixed JSON handshake) but resolve as soon as the upgrade completes
 * — or the timeout / an error fires — and leave the socket under the CALLER's control rather than
 * closing it once a marker is found. `--check switch-sockets` needs a client-held socket that stays
 * open across a real switch, then closes it itself on command: that close is the EXACT
 * `clientSocket.on('close')` trigger a real browser's iframe navigation would produce, because the
 * server cannot distinguish the two (`92-RESEARCH.md` `## 3`).
 */
async function openProxiedSocket({ port, idSegment, timeoutMs }) {
  return new Promise((resolve) => {
    let opened = false;
    let closeCode = null;
    let settled = false;
    const url = `ws://127.0.0.1:${port}/sessions/${idSegment}/terminal/ws`;
    const ws = new WebSocket(url, ["tty"]);
    ws.binaryType = "arraybuffer";
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ws, opened, closeCode });
    };
    const timer = setTimeout(finish, timeoutMs);
    ws.addEventListener("open", () => {
      opened = true;
      ws.send(JSON.stringify({ AuthToken: "", columns: 120, rows: 40 }));
      finish();
    });
    ws.addEventListener("close", (event) => {
      closeCode = event.code;
      finish();
    });
    ws.addEventListener("error", finish);
  });
}

/**
 * Close a socket {@link openProxiedSocket} handed back and wait for its OWN `close` event, never a
 * bare fire-and-forget `ws.close()` — so the caller's next poll genuinely starts after the
 * client-side half of teardown has begun, matching what a real browser's own close sequence does.
 */
async function closeProxiedSocket(ws) {
  return new Promise((resolve) => {
    if (ws.readyState === WebSocket.CLOSED) {
      resolve();
      return;
    }
    ws.addEventListener("close", () => resolve(), { once: true });
    ws.close();
  });
}

/**
 * `--check switch-sockets` (PROXY-01, `92-VALIDATION.md` C2): the socket to a ttyd port belongs to
 * the SANDBOX SERVER process, never to any client (`92-RESEARCH.md` `## 3`) — so every count in
 * this check is scoped to `built.server.child.pid`, on the OLD session's ttyd port, filtered to
 * `-sTCP:ESTABLISHED` only (never the HTTP-forward leg, which closes every request and would read a
 * near-constant regardless of the WS leak this check exists to catch). Sequence: open a real
 * client-held proxied WS to session A, assert the PRE-CONDITION count reads exactly 1 (a 0 here
 * means the instrument itself is blind — the single assertion that keeps this whole check from
 * being a constant, `92-VALIDATION.md`'s Dead-Instrument Register), drive a REAL switch through the
 * real route, close A's client-held socket (the exact `clientSocket.on('close')` trigger a browser's
 * iframe navigation produces), then POLL A's port to zero bounded by {@link SOCKET_TEARDOWN_POLL_MS}
 * — a MEASURED bound (plan 01's 5 real readings, max 14ms), never an asserted latency, and
 * exhausting it is a FAILURE, never a retry. Finally opens a fresh proxied WS to session B and
 * re-asserts exactly 1 ESTABLISHED row on B's port, proving the count MOVED to the new port rather
 * than merely vanishing everywhere.
 */
async function checkSwitchSockets(built) {
  const violations = [];
  const serverPid = built.server?.child?.pid;
  if (!serverPid) {
    violations.push(
      "switch-sockets: sandbox server pid unresolved — cannot scope the socket count to it",
    );
    return violations;
  }

  const socketA = await openProxiedSocket({
    port: built.port,
    idSegment: built.sessionA.id,
    timeoutMs: PROXY_READ_TIMEOUT_MS,
  });
  console.log(
    `switch-sockets: opened session A's client-held proxied socket — opened=${socketA.opened} closeCode=${socketA.closeCode}`,
  );
  if (!socketA.opened) {
    violations.push(
      `switch-sockets: session A's proxied WS never opened (closeCode=${socketA.closeCode}) — cannot proceed`,
    );
    return violations;
  }

  const preCount = await countEstablishedToPort(built.ttyd.a.port, serverPid);
  console.log(
    `switch-sockets: PRE count on port ${built.ttyd.a.port} (session A) owned by pid ${serverPid} = ${preCount.count} endpoints=${JSON.stringify(preCount.endpoints)}`,
  );
  if (preCount.count !== 1) {
    violations.push(
      `switch-sockets: PRE-CONDITION VIOLATED — expected exactly 1 ESTABLISHED row on port ${built.ttyd.a.port} owned by pid ${serverPid} before the switch, actual ${preCount.count}. A 0 reading here means the counting instrument is blind, not that nothing leaked.`,
    );
    await closeProxiedSocket(socketA.ws);
    return violations;
  }

  const switchRes = await fetch(
    `http://127.0.0.1:${built.port}/api/cards/${built.cardId}/session`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: built.sessionB.id }),
    },
  );
  console.log(
    `switch-sockets: POST /api/cards/${built.cardId}/session sessionId=${built.sessionB.id} -> ${switchRes.status}`,
  );
  if (switchRes.status < 200 || switchRes.status >= 300) {
    violations.push(
      `switch-sockets: switch POST expected a 2xx status, actual ${switchRes.status}`,
    );
  }
  const afterSwitch = await fetchFixtureCard(built);
  console.log(
    `switch-sockets: wire activeSession.id after switch = ${afterSwitch?.activeSession?.id} (expected ${built.sessionB.id})`,
  );
  if (afterSwitch?.activeSession?.id !== built.sessionB.id) {
    violations.push(
      `switch-sockets: wire activeSession.id expected ${built.sessionB.id} after the switch, actual ${afterSwitch?.activeSession?.id} — refusing to claim a socket result about a switch that never actually happened`,
    );
  }

  await closeProxiedSocket(socketA.ws);
  console.log(
    `switch-sockets: closed session A's client-held socket — simulating the browser's iframe navigating away`,
  );

  const pollStart = Date.now();
  let afterCount = await countEstablishedToPort(built.ttyd.a.port, serverPid);
  while (
    afterCount.count > 0 &&
    Date.now() - pollStart < SOCKET_TEARDOWN_POLL_MS
  ) {
    await sleep(10);
    afterCount = await countEstablishedToPort(built.ttyd.a.port, serverPid);
  }
  const elapsedMs = Date.now() - pollStart;
  console.log(
    `switch-sockets: poll-to-zero on port ${built.ttyd.a.port} (session A, OLD) — finalCount=${afterCount.count} elapsedMs=${elapsedMs} budget=${SOCKET_TEARDOWN_POLL_MS}ms`,
  );
  if (afterCount.count > 0) {
    violations.push(
      `switch-sockets: LEAK — port ${built.ttyd.a.port} (session A, the OLD session) still has ${afterCount.count} ESTABLISHED row(s) owned by pid ${serverPid} after ${elapsedMs}ms (budget ${SOCKET_TEARDOWN_POLL_MS}ms): ${JSON.stringify(afterCount.endpoints)}`,
    );
  }

  const socketB = await openProxiedSocket({
    port: built.port,
    idSegment: built.sessionB.id,
    timeoutMs: PROXY_READ_TIMEOUT_MS,
  });
  console.log(
    `switch-sockets: opened session B's proxied socket — opened=${socketB.opened} closeCode=${socketB.closeCode}`,
  );
  if (!socketB.opened) {
    violations.push(
      `switch-sockets: session B's proxied WS never opened (closeCode=${socketB.closeCode})`,
    );
  } else {
    const postCount = await countEstablishedToPort(
      built.ttyd.b.port,
      serverPid,
    );
    console.log(
      `switch-sockets: POST count on port ${built.ttyd.b.port} (session B, NEW) owned by pid ${serverPid} = ${postCount.count} endpoints=${JSON.stringify(postCount.endpoints)}`,
    );
    if (postCount.count !== 1) {
      violations.push(
        `switch-sockets: POST-CONDITION expected exactly 1 ESTABLISHED row on port ${built.ttyd.b.port} owned by pid ${serverPid}, actual ${postCount.count} — the count must MOVE to the new session's port, not merely vanish`,
      );
    }
    await closeProxiedSocket(socketB.ws);
  }

  return violations;
}

/**
 * `--check switch-atomicity` (SESS-03, `92-VALIDATION.md` C3): the single-writer `enqueue` queue
 * (`92-RESEARCH.md` `## 5`) is exercised with REAL concurrent HTTP traffic and a REAL tmux kill,
 * never reasoned about from the source alone. Two interleavings:
 *
 * 1. 50+ concurrent switch POSTs (alternating A/B, fired with no awaiting between them) plus 50+
 *    concurrent board reads. Every read is checked against the KNOWN, FIXED values for whichever
 *    session it reports active — both the wire's `activeSession.tmuxSession`/`ttydPort` (re-derived
 *    at redaction time straight from the session record, per `redactCard`) AND the card-level flat
 *    mirror `tmuxSession`/`ttydPort` (`setActiveSession`'s six-field projection,
 *    `board.store.ts:579-585`) — a torn projection is exactly a flat mirror that lags the pointer,
 *    and the flat top-level fields are the ones a bypass of `setActiveSession` actually staves,
 *    since `activeSession.*` is re-derived fresh from `card.sessions` on every read regardless.
 *    After the storm, the PERSISTED row is read directly (the wire redacts `sessions`) and asserted
 *    to have `activeSessionId` resolve to a real record, non-empty `sessions`.
 * 2. Session B's real tmux is killed, then the switch to B is fired WITHOUT awaiting the real
 *    3-strike detector — a genuine race against `markSessionLost`, not a simulated one. Whichever
 *    mutation's `enqueue`d body ran first is observed by sampling B's persisted `tmuxSession` the
 *    instant the switch POST itself resolves (that POST only resolves once its own queued mutator
 *    has fully committed, `board.store.ts:731`'s `return this.queue`) — printed for diagnosability,
 *    never asserted as a required winner. Both legitimate final shapes are accepted: `activeSessionId`
 *    resolves to a real record, `sessions` still holds BOTH records (`markSessionLost` clears fields
 *    in place, never removes one), and if the pointer settles on the untouched sibling (A), A must
 *    still read as genuinely alive — the one shape that would actually be torn.
 */
async function checkSwitchAtomicity(built) {
  const violations = [];
  const knownIds = new Set([built.sessionA.id, built.sessionB.id]);
  const knownSessions = {
    [built.sessionA.id]: {
      tmuxSession: built.tmux.a,
      ttydPort: built.ttyd.a.port,
    },
    [built.sessionB.id]: {
      tmuxSession: built.tmux.b,
      ttydPort: built.ttyd.b.port,
    },
  };

  const SWITCH_COUNT = 60;
  const READ_COUNT = 60;
  const readViolations = [];
  let non2xxSwitches = 0;
  const writes = [];
  for (let i = 0; i < SWITCH_COUNT; i++) {
    const target = i % 2 === 0 ? built.sessionB.id : built.sessionA.id;
    writes.push(
      fetch(
        `http://127.0.0.1:${built.port}/api/cards/${built.cardId}/session`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionId: target }),
        },
      )
        .then((r) => {
          if (r.status < 200 || r.status >= 300) non2xxSwitches += 1;
        })
        .catch(() => {
          non2xxSwitches += 1;
        }),
    );
  }
  const reads = [];
  for (let i = 0; i < READ_COUNT; i++) {
    reads.push(
      fetch(`http://127.0.0.1:${built.port}/api/board`)
        .then((r) => r.json())
        .then((body) => {
          const cards = Array.isArray(body?.cards) ? body.cards : [];
          const card = cards.find((c) => c.id === built.cardId);
          if (!card) return;
          const active = card.activeSession;
          if (active == null) {
            readViolations.push(`read ${i}: activeSession absent`);
            return;
          }
          if (!knownIds.has(active.id)) {
            readViolations.push(
              `read ${i}: activeSession.id "${active.id}" is not one of the two known session ids`,
            );
            return;
          }
          const known = knownSessions[active.id];
          if (active.tmuxSession !== known.tmuxSession) {
            readViolations.push(
              `read ${i}: activeSession(${active.id}).tmuxSession expected "${known.tmuxSession}", actual ${JSON.stringify(active.tmuxSession)} — torn nested projection`,
            );
          }
          if (active.ttydPort !== known.ttydPort) {
            readViolations.push(
              `read ${i}: activeSession(${active.id}).ttydPort expected ${known.ttydPort}, actual ${JSON.stringify(active.ttydPort)} — torn nested projection`,
            );
          }
          if (card.tmuxSession !== known.tmuxSession) {
            readViolations.push(
              `read ${i}: card.tmuxSession (flat mirror) expected "${known.tmuxSession}" for active session ${active.id}, actual ${JSON.stringify(card.tmuxSession)} — flat mirror lags the pointer`,
            );
          }
          if (card.ttydPort !== known.ttydPort) {
            readViolations.push(
              `read ${i}: card.ttydPort (flat mirror) expected ${known.ttydPort} for active session ${active.id}, actual ${JSON.stringify(card.ttydPort)} — flat mirror lags the pointer`,
            );
          }
          if (
            !Array.isArray(card.sessionSummaries) ||
            card.sessionSummaries.length !== 2
          ) {
            readViolations.push(
              `read ${i}: sessionSummaries expected 2 entries, actual ${JSON.stringify(card.sessionSummaries)}`,
            );
          }
        })
        .catch((err) => {
          readViolations.push(`read ${i}: fetch failed: ${err.message}`);
        }),
    );
  }
  await Promise.all([...writes, ...reads]);
  console.log(
    `switch-atomicity: interleaving 1 — ${SWITCH_COUNT} switch POSTs (${non2xxSwitches} non-2xx/failed) + ${READ_COUNT} board GETs fired concurrently, ${readViolations.length} mirror-agreement violation(s)`,
  );
  violations.push(...readViolations);
  if (non2xxSwitches > 0) {
    violations.push(
      `switch-atomicity: interleaving 1 — ${non2xxSwitches}/${SWITCH_COUNT} switch POSTs did not return 2xx, though both A and B are valid targets throughout`,
    );
  }

  const afterStorm = readCard(built.dbPath, built.cardId);
  if (!afterStorm) {
    violations.push(
      `switch-atomicity: interleaving 1 — card ${built.cardId} missing from persisted board.db after the storm`,
    );
  } else {
    const sessions = afterStorm.sessions ?? [];
    const activeRecord = sessions.find(
      (s) => s.id === afterStorm.activeSessionId,
    );
    console.log(
      `switch-atomicity: interleaving 1 — persisted activeSessionId=${afterStorm.activeSessionId} resolves=${activeRecord != null}, sessions.length=${sessions.length}`,
    );
    if (sessions.length === 0) {
      violations.push(
        `switch-atomicity: interleaving 1 — persisted sessions[] is empty — SESS-03's "N sessions and no active one" case`,
      );
    }
    if (afterStorm.activeSessionId == null || !activeRecord) {
      violations.push(
        `switch-atomicity: interleaving 1 — persisted activeSessionId "${afterStorm.activeSessionId}" does not resolve to a record in sessions[] — a pointer at a session that does not exist`,
      );
    }
  }

  // Deterministic follow-up, not relying on the concurrent storm's own luck: a single AWAITED
  // switch to a KNOWN target, then ONE read, asserting the flat mirror against that target's known
  // values. Empirically, 60 fire-and-forget switches racing 60 fire-and-forget reads settle so fast
  // (each mutation is a synchronous body + persist, no I/O wait) that the concurrent reads above
  // rarely land inside the torn window a direct `card.activeSessionId =` assignment would produce —
  // this deterministic step is what actually proves the flat-mirror claim on every run, not just
  // probabilistically.
  const deterministicTarget = built.sessionB.id;
  const deterministicRes = await fetch(
    `http://127.0.0.1:${built.port}/api/cards/${built.cardId}/session`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: deterministicTarget }),
    },
  );
  const deterministicCard = await fetchFixtureCard(built);
  console.log(
    `switch-atomicity: interleaving 1 deterministic follow-up — switch to B -> ${deterministicRes.status}; wire activeSession.id=${deterministicCard?.activeSession?.id} card.tmuxSession=${JSON.stringify(deterministicCard?.tmuxSession)} card.ttydPort=${deterministicCard?.ttydPort}`,
  );
  if (deterministicCard?.activeSession?.id !== deterministicTarget) {
    violations.push(
      `switch-atomicity: interleaving 1 deterministic follow-up — the awaited switch to B never landed (activeSession.id=${deterministicCard?.activeSession?.id})`,
    );
  } else {
    const known = knownSessions[deterministicTarget];
    if (deterministicCard.tmuxSession !== known.tmuxSession) {
      violations.push(
        `switch-atomicity: interleaving 1 deterministic follow-up — card.tmuxSession (flat mirror) expected "${known.tmuxSession}" after an AWAITED switch to B, actual ${JSON.stringify(deterministicCard.tmuxSession)} — the flat mirror lagged its pointer`,
      );
    }
    if (deterministicCard.ttydPort !== known.ttydPort) {
      violations.push(
        `switch-atomicity: interleaving 1 deterministic follow-up — card.ttydPort (flat mirror) expected ${known.ttydPort} after an AWAITED switch to B, actual ${JSON.stringify(deterministicCard.ttydPort)} — the flat mirror lagged its pointer`,
      );
    }
    if (deterministicCard.activeSession?.tmuxSession !== known.tmuxSession) {
      violations.push(
        `switch-atomicity: interleaving 1 deterministic follow-up — activeSession.tmuxSession expected "${known.tmuxSession}", actual ${JSON.stringify(deterministicCard.activeSession?.tmuxSession)}`,
      );
    }
  }

  await tmuxKillSession(built.tmux.b);
  const start2 = Date.now();
  console.log(
    `switch-atomicity: interleaving 2 — killed real tmux session ${built.tmux.b} (session B, ${built.sessionB.id}); firing the switch to B without awaiting loss detection`,
  );
  const switchStatus = await fetch(
    `http://127.0.0.1:${built.port}/api/cards/${built.cardId}/session`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: built.sessionB.id }),
    },
  )
    .then((r) => r.status)
    .catch((err) => `error: ${err.message}`);
  const elapsedSwitch = Date.now() - start2;
  const atSwitchSettle = readCard(built.dbPath, built.cardId);
  const bAtSwitchSettle = atSwitchSettle?.sessions?.find(
    (s) => s.id === built.sessionB.id,
  );
  const order =
    bAtSwitchSettle?.tmuxSession == null ? "loss-first" : "switch-first";
  console.log(
    `switch-atomicity: interleaving 2 — switch POST resolved status=${switchStatus} after ${elapsedSwitch}ms; observed order = ${order} (B's persisted tmuxSession at switch-settle = ${JSON.stringify(bAtSwitchSettle?.tmuxSession)})`,
  );

  let lossLanded = bAtSwitchSettle?.tmuxSession == null;
  const deadline2 = start2 + LIVENESS_POLL_TIMEOUT_MS;
  while (!lossLanded && Date.now() < deadline2) {
    await sleep(LIVENESS_POLL_INTERVAL_MS);
    const p = readCard(built.dbPath, built.cardId);
    const bRecord = p?.sessions?.find((s) => s.id === built.sessionB.id);
    if (bRecord && bRecord.tmuxSession == null) lossLanded = true;
  }
  const elapsed2 = Date.now() - start2;
  console.log(
    `switch-atomicity: interleaving 2 — loss detection landed=${lossLanded} elapsedMs=${elapsed2} budget=${LIVENESS_POLL_TIMEOUT_MS}ms`,
  );
  if (!lossLanded) {
    violations.push(
      `switch-atomicity: interleaving 2 — the real 3-strike detector did not clear session B (${built.sessionB.id}) within ${LIVENESS_POLL_TIMEOUT_MS}ms after the switch settled; a timeout here is a FAILURE, never a retry`,
    );
  }

  const finalCard = readCard(built.dbPath, built.cardId);
  if (!finalCard) {
    violations.push(
      `switch-atomicity: interleaving 2 — card ${built.cardId} missing from persisted board.db`,
    );
  } else {
    const sessions = finalCard.sessions ?? [];
    const aRecord = sessions.find((s) => s.id === built.sessionA.id);
    const bRecord = sessions.find((s) => s.id === built.sessionB.id);
    const activeRecord = sessions.find(
      (s) => s.id === finalCard.activeSessionId,
    );
    console.log(
      `switch-atomicity: interleaving 2 final — activeSessionId=${finalCard.activeSessionId}, A present=${!!aRecord}, B present=${!!bRecord}, B.tmuxSession=${JSON.stringify(bRecord?.tmuxSession)}, A.tmuxSession=${JSON.stringify(aRecord?.tmuxSession)}`,
    );
    if (!aRecord || !bRecord) {
      violations.push(
        `switch-atomicity: interleaving 2 — expected BOTH session records to survive (markSessionLost clears fields in place, never removes), actual A present=${!!aRecord} B present=${!!bRecord}`,
      );
    }
    if (!activeRecord) {
      violations.push(
        `switch-atomicity: interleaving 2 — activeSessionId "${finalCard.activeSessionId}" does not resolve to a session record — a pointer at a session that does not exist`,
      );
    } else if (
      activeRecord.id === built.sessionA.id &&
      activeRecord.tmuxSession == null
    ) {
      violations.push(
        `switch-atomicity: interleaving 2 — active session resolved to A but A's own persisted tmuxSession is null — A was never killed, so this is a torn state, not the documented lost-sibling case`,
      );
    }
  }

  return violations;
}

/**
 * `--check cleanup-fixture` (Phase 93 Wave 0 deliverable): proves {@link WORKTREE_FIXTURE} really
 * built REAL, git-registered worktrees — not directories a fixture merely happened to `mkdirSync` —
 * so every later teardown check in this phase has something real to destroy. Registration is read
 * from `git worktree list --porcelain`, the git command itself, never `existsSync`: a directory
 * survives on disk regardless of whether `worktreeAddNewBranch` ever ran, which is exactly the
 * dead-instrument hazard the Phase 93 Dead-Instrument Register names for this criterion (see the
 * WRONG-SUBJECT break recorded in the SUMMARY). Every asserted path is also re-run through
 * {@link assertUnderTmpdir} and printed, so a passing run's own output is readable containment
 * evidence, not just an implicit property of the fixture profile.
 */
async function checkCleanupFixture(built) {
  const violations = [];

  const { stdout: listOut } = await execFileP(
    "git",
    ["worktree", "list", "--porcelain"],
    { cwd: built.repoPath },
  );
  const registered = new Set();
  for (const line of listOut.split("\n")) {
    if (!line.startsWith("worktree ")) continue;
    const p = line.slice("worktree ".length);
    registered.add(existsSync(p) ? realpathSync(p) : p);
  }

  for (const key of built.sessionKeys) {
    const wtPath = built.worktreePaths[key];
    assertUnderTmpdir(wtPath, `worktree path (session ${key})`);
    console.log(
      `cleanup-fixture: worktree path (session ${key}) under tmpdir — ${wtPath}`,
    );
    const isRegistered =
      existsSync(wtPath) && registered.has(realpathSync(wtPath));
    if (!isRegistered) {
      violations.push(
        `cleanup-fixture: worktree for session ${key} is not registered in \`git worktree list\`: ${wtPath} (registered: ${[...registered].join(", ")})`,
      );
    }
    const trackedFile = join(wtPath, `session-${key}.txt`);
    if (!existsSync(trackedFile)) {
      violations.push(
        `cleanup-fixture: committed fixture file missing from worktree for session ${key}: ${trackedFile}`,
      );
    }
  }

  const { stdout: branchOut } = await execFileP("git", ["branch", "--list"], {
    cwd: built.repoPath,
  });
  for (const key of built.sessionKeys) {
    const branch = built.branches[key];
    if (!branchOut.includes(branch)) {
      violations.push(
        `cleanup-fixture: branch for session ${key} not found in \`git branch --list\`: ${branch}`,
      );
    }
  }

  assertUnderTmpdir(built.repoPath, "fixture repo");
  console.log(`cleanup-fixture: fixture repo under tmpdir — ${built.repoPath}`);

  const persisted = readCard(built.dbPath, built.cardId);
  for (const key of built.sessionKeys) {
    const sessionId = built[SESSION_FIELD_BY_KEY[key]]?.id;
    const record = persisted?.sessions?.find((s) => s.id === sessionId);
    if (!record) {
      violations.push(
        `cleanup-fixture: persisted card is missing the session record for key ${key} (id ${sessionId})`,
      );
      continue;
    }
    if (!record.workspacePath) {
      violations.push(
        `cleanup-fixture: persisted session ${key} is missing workspacePath`,
      );
    }
    const persistedRepoPath = record.workspace?.repos?.[0]?.path;
    if (persistedRepoPath !== built.repoPath) {
      violations.push(
        `cleanup-fixture: persisted session ${key} workspace.repos[0].path (${persistedRepoPath}) !== built.repoPath (${built.repoPath})`,
      );
    }
  }

  const live = await tmuxListSessionNames();
  for (const key of built.sessionKeys) {
    if (!live.includes(built.tmux[key])) {
      violations.push(
        `cleanup-fixture: tmux session for key ${key} is not live: ${built.tmux[key]}`,
      );
    }
    if (!(await isPortListening(built.ttyd[key].port))) {
      violations.push(
        `cleanup-fixture: ttyd port for key ${key} is not LISTENING: ${built.ttyd[key].port}`,
      );
    }
  }

  console.log(
    `cleanup-fixture: registered worktrees=[${[...registered].join(", ")}] branches=[${built.sessionKeys.map((k) => built.branches[k]).join(", ")}] ttyd ports=[${built.sessionKeys.map((k) => built.ttyd[k].port).join(", ")}]`,
  );

  return violations;
}

/**
 * `--check cleanup-isolation` stage 1 of 2 (Phase 93, criterion 5's fan-out breadth, a preliminary
 * observation rather than the isolation claim itself): the manual `/cleanup` route fans out over
 * EVERY session the card owns (`93-03`'s `runCleanupFanOut`), so on a CLEAN fixture where both
 * sessions are due, both must be attempted and removed. This is NOT the discriminating check for
 * criterion 1 — a manual click cleaning everything on the card is the documented, correct behaviour
 * (`93-CONTEXT.md`'s "one mental model for cleaning up this ticket"), not a bug. It exists only to
 * confirm the fan-out itself reaches every session before {@link checkCleanupIsolationScheduler}
 * exercises the actual per-session isolation claim via the scheduler, which dispatches teardown to
 * exactly the sessions that are due — never a blind "clean everything" sweep.
 */
async function checkCleanupIsolationFanout(built) {
  const violations = [];

  const moveStatus = await moveCard(built, "done");
  console.log(
    `cleanup-isolation (fan-out sanity): POST /move to done -> ${moveStatus} (expected 204)`,
  );
  if (moveStatus !== 204) {
    violations.push(
      `cleanup-isolation (fan-out sanity): POST /move to done returned ${moveStatus}, expected 204`,
    );
    return violations;
  }

  const cleanupStatus = await postCleanup(built, { force: false });
  console.log(
    `cleanup-isolation (fan-out sanity): POST /cleanup {force:false} -> ${cleanupStatus} (expected 202)`,
  );
  if (cleanupStatus !== 202) {
    violations.push(
      `cleanup-isolation (fan-out sanity): POST /cleanup returned ${cleanupStatus}, expected 202`,
    );
    return violations;
  }

  const deadline = Date.now() + CLEANUP_ISOLATION_SETTLE_TIMEOUT_MS;
  let finalCard;
  let bothGone = false;
  while (Date.now() < deadline) {
    finalCard = readCard(built.dbPath, built.cardId);
    const remaining = (finalCard?.sessions ?? []).map((s) => s.id);
    bothGone =
      !remaining.includes(built.sessionA.id) &&
      !remaining.includes(built.sessionB.id);
    if (bothGone) break;
    await sleep(POLL_INTERVAL_MS);
  }
  console.log(
    `cleanup-isolation (fan-out sanity): both session records removed=${bothGone} — remaining: ${JSON.stringify((finalCard?.sessions ?? []).map((s) => s.id))}`,
  );
  if (!bothGone) {
    violations.push(
      `cleanup-isolation (fan-out sanity): the manual /cleanup fan-out did not remove BOTH session ` +
        `records (A=${built.sessionA.id}, B=${built.sessionB.id}) within ${CLEANUP_ISOLATION_SETTLE_TIMEOUT_MS}ms`,
    );
  }
  return violations;
}

/**
 * `--check cleanup-isolation` stage 2 of 2 — the actual criterion 1 / criterion 5 claim, driven
 * through the REAL scheduler (`sessionsDueForCleanup` / `runDueCleanups`), never a bespoke
 * single-session entry point: session A stays active throughout, session B is the ONLY session
 * seeded past-due, so a card-flat read (which mirrors the ACTIVE session, i.e. A) would tear down
 * the WRONG session — exactly the failure this check exists to catch. Steps below are numbered
 * against `93-05-PLAN.md`'s own sequence.
 * @remarks NEW-14 ordering (criterion 5) is proven BY CONSEQUENCE, not by observing an in-process
 * call order the harness cannot see from outside: DELETE-BEFORE-KILL is proven via a
 * restart-and-adoption scan (a tracked entry deleted AFTER its kill would let `adoptAndSweep`
 * re-adopt or a fresh ttyd respawn under B's old session id; deleted BEFORE, as production does,
 * means nothing on the machine still answers to B's id, while A — untouched — is RE-ADOPTED with
 * the SAME pid). PRUNE-LAST scoping is proven via A's own registration surviving B's prune in the
 * SAME shared repo. Moving the prune earlier WITHIN `cleanupWorkspace` is END-STATE EQUIVALENT on
 * this clean teardown (no rejected `worktreeRemove`, no stale git-admin entry to leave behind), so
 * no break can be constructed for that specific reorder from outside the process — recorded
 * honestly in the SUMMARY rather than claimed as proven, the same way `92-VERDICT.md` recorded C7's
 * absence of a break-proof.
 */
async function checkCleanupIsolationScheduler(built) {
  const violations = [];
  const aWt = built.worktreePaths.a;
  const bWt = built.worktreePaths.b;

  // 1. BASELINE — asserted, not assumed. Every later claim is a DIFFERENCE from this.
  let registered = await gitWorktreeListRegistered(built.repoPath);
  const aRegisteredBefore =
    existsSync(aWt) && registered.has(realpathSync(aWt));
  const bRegisteredBefore =
    existsSync(bWt) && registered.has(realpathSync(bWt));
  const liveBefore = await tmuxListSessionNames();
  const aTmuxBefore = liveBefore.includes(built.tmux.a);
  const bTmuxBefore = liveBefore.includes(built.tmux.b);
  const aListenBefore = await isPortListening(built.ttyd.a.port);
  const bListenBefore = await isPortListening(built.ttyd.b.port);
  const { stdout: branchOutBefore } = await execFileP(
    "git",
    ["branch", "--list"],
    { cwd: built.repoPath },
  );
  const aBranchBefore = branchOutBefore.includes(built.branches.a);
  const bBranchBefore = branchOutBefore.includes(built.branches.b);
  const aPidBefore = (await pidsListeningOnPort(built.ttyd.a.port))[0];
  const bPidBefore = (await pidsListeningOnPort(built.ttyd.b.port))[0];
  console.log(
    `cleanup-isolation: BASELINE A — registered=${aRegisteredBefore} tmux=${aTmuxBefore} ` +
      `ttyd(${built.ttyd.a.port})=${aListenBefore} pid=${aPidBefore} branch(${built.branches.a})=${aBranchBefore}`,
  );
  console.log(
    `cleanup-isolation: BASELINE B — registered=${bRegisteredBefore} tmux=${bTmuxBefore} ` +
      `ttyd(${built.ttyd.b.port})=${bListenBefore} pid=${bPidBefore} branch(${built.branches.b})=${bBranchBefore}`,
  );
  if (
    !aRegisteredBefore ||
    !bRegisteredBefore ||
    !aTmuxBefore ||
    !bTmuxBefore ||
    !aListenBefore ||
    !bListenBefore ||
    !aBranchBefore ||
    !bBranchBefore ||
    aPidBefore == null ||
    bPidBefore == null
  ) {
    violations.push(
      `cleanup-isolation: BASELINE could not be established — a baseline that cannot be established ` +
        `is a hard violation, since every claim below is a difference from it (A: registered=${aRegisteredBefore} ` +
        `tmux=${aTmuxBefore} ttyd=${aListenBefore} branch=${aBranchBefore} pid=${aPidBefore}; B: ` +
        `registered=${bRegisteredBefore} tmux=${bTmuxBefore} ttyd=${bListenBefore} branch=${bBranchBefore} pid=${bPidBefore})`,
    );
    return violations;
  }

  // 2. Prove B answerable BEFORE the teardown — the precondition that keeps step 6 from being vacuous.
  const preMarkerB = `cleanup-isolation-pre-b-${built.port}-${randomBytes(4).toString("hex")}`;
  await writePaneMarker(built.tmux.b, built.home, preMarkerB);
  const preReadB = await readPaneThroughProxy({
    port: built.port,
    idSegment: built.sessionB.id,
    expect: preMarkerB,
    timeoutMs: PROXY_READ_TIMEOUT_MS,
  });
  console.log(
    `cleanup-isolation: PRECONDITION — B answerable before teardown: opened=${preReadB.opened} ` +
      `containsMarker=${preReadB.text.includes(preMarkerB)}`,
  );
  if (!preReadB.opened || !preReadB.text.includes(preMarkerB)) {
    violations.push(
      `cleanup-isolation: PRECONDITION FAILED — session B was not answerable before its own teardown ` +
        `(opened=${preReadB.opened}, marker "${preMarkerB}" found=${preReadB.text.includes(preMarkerB)}) — ` +
        `a B that was never answerable cannot demonstrate it stayed so, so the claim below would be vacuous`,
    );
    return violations;
  }

  // 3. Move to Done through the real board, then seed ONLY B's cleanupDueAt past-due and drive the
  //    real scheduler — never a bespoke single-session entry point.
  const moveStatus = await moveCard(built, "done");
  console.log(
    `cleanup-isolation: POST /move to done -> ${moveStatus} (expected 204)`,
  );
  if (moveStatus !== 204) {
    violations.push(
      `cleanup-isolation: POST /move to done returned ${moveStatus}, expected 204`,
    );
    return violations;
  }
  await killAndWait(built.server?.child);
  const cardAtDone = readCard(built.dbPath, built.cardId);
  if (!cardAtDone || cardAtDone.column !== "done") {
    violations.push(
      `cleanup-isolation: persisted card is not column=done after the move (actual: ${cardAtDone?.column})`,
    );
    return violations;
  }
  const aRecordAtDone = cardAtDone.sessions?.find(
    (s) => s.id === built.sessionA.id,
  );
  const bRecordAtDone = cardAtDone.sessions?.find(
    (s) => s.id === built.sessionB.id,
  );
  if (!aRecordAtDone || !bRecordAtDone) {
    violations.push(
      `cleanup-isolation: persisted card is missing a session record right after Done arrival ` +
        `(a=${!!aRecordAtDone} b=${!!bRecordAtDone})`,
    );
    return violations;
  }
  bRecordAtDone.cleanupDueAt = Date.now() - 5_000;
  console.log(
    `cleanup-isolation: seeded ONLY session B's cleanupDueAt in the past (${bRecordAtDone.cleanupDueAt}); ` +
      `A's own Done-arrival stamp (${aRecordAtDone.cleanupDueAt}) is left untouched, days in the future, so A is never due`,
  );
  seedFixtureCard(built.home, cardAtDone);

  const priorTickEnv = process.env.DISPATCH_CLEANUP_TICK_MS;
  process.env.DISPATCH_CLEANUP_TICK_MS = "500";
  try {
    built.server = bootServer(built.home);
    await waitForReady(built.port);
  } finally {
    if (priorTickEnv === undefined) delete process.env.DISPATCH_CLEANUP_TICK_MS;
    else process.env.DISPATCH_CLEANUP_TICK_MS = priorTickEnv;
  }
  console.log(
    `cleanup-isolation: sandbox server restarted with DISPATCH_CLEANUP_TICK_MS=500 — the scheduler's ` +
      `own boot-time tick should pick up session B within a few ticks`,
  );

  const settleDeadline = Date.now() + CLEANUP_ISOLATION_SETTLE_TIMEOUT_MS;
  let settledCard;
  let bGone = false;
  while (Date.now() < settleDeadline) {
    settledCard = readCard(built.dbPath, built.cardId);
    bGone =
      settledCard != null &&
      !(settledCard.sessions ?? []).some((s) => s.id === built.sessionB.id);
    if (bGone) break;
    await sleep(POLL_INTERVAL_MS);
  }
  console.log(
    `cleanup-isolation: scheduler settle — B's session record gone=${bGone} within ${CLEANUP_ISOLATION_SETTLE_TIMEOUT_MS}ms`,
  );
  if (!bGone) {
    violations.push(
      `cleanup-isolation: session B was not torn down by the real scheduler within ` +
        `${CLEANUP_ISOLATION_SETTLE_TIMEOUT_MS}ms of its cleanupDueAt going past-due — ` +
        `sessionsDueForCleanup/runDueCleanups never dispatched it`,
    );
    return violations;
  }

  // 4. A-SIDE (the survivor).
  registered = await gitWorktreeListRegistered(built.repoPath);
  const aRegisteredAfter = existsSync(aWt) && registered.has(realpathSync(aWt));
  const aDirAfter = existsSync(aWt);
  const liveAfter = await tmuxListSessionNames();
  const aTmuxAfter = liveAfter.includes(built.tmux.a);
  const aListenAfter = await isPortListening(built.ttyd.a.port);
  console.log(
    `cleanup-isolation: A-SIDE (survivor) — registered=${aRegisteredAfter} dir=${aDirAfter} ` +
      `tmux=${aTmuxAfter} ttyd(${built.ttyd.a.port})=${aListenAfter}`,
  );
  if (!aRegisteredAfter) {
    violations.push(
      `cleanup-isolation: A-SIDE VIOLATED — A's worktree ${aWt} is no longer registered in ` +
        `\`git worktree list\` after cleaning B — the sibling's worktree was destroyed`,
    );
  }
  if (!aDirAfter) {
    violations.push(
      `cleanup-isolation: A-SIDE VIOLATED — A's worktree directory ${aWt} no longer exists on disk after cleaning B`,
    );
  }
  if (!aTmuxAfter) {
    violations.push(
      `cleanup-isolation: A-SIDE VIOLATED — A's tmux session ${built.tmux.a} is no longer live after cleaning B`,
    );
  }
  if (!aListenAfter) {
    violations.push(
      `cleanup-isolation: A-SIDE VIOLATED — A's ttyd port ${built.ttyd.a.port} is no longer LISTENING after cleaning B`,
    );
  }

  // 5. B-SIDE (the target).
  const bRegisteredAfter = existsSync(bWt) && registered.has(realpathSync(bWt));
  const bDirAfter = existsSync(bWt);
  const bTmuxAfter = liveAfter.includes(built.tmux.b);
  const bListenAfter = await isPortListening(built.ttyd.b.port);
  const bPidGone =
    bPidBefore != null
      ? await waitForPidGone(bPidBefore, KILL_TIMEOUT_MS)
      : true;
  console.log(
    `cleanup-isolation: B-SIDE (target) — registered=${bRegisteredAfter} dir=${bDirAfter} ` +
      `tmux=${bTmuxAfter} ttyd(${built.ttyd.b.port})=${bListenAfter} pidGone=${bPidGone}`,
  );
  if (bRegisteredAfter) {
    violations.push(
      `cleanup-isolation: B-SIDE VIOLATED — B's worktree ${bWt} is still registered in ` +
        `\`git worktree list\` after its own teardown`,
    );
  }
  if (bDirAfter) {
    violations.push(
      `cleanup-isolation: B-SIDE VIOLATED — B's worktree directory ${bWt} still exists on disk after its own teardown`,
    );
  }
  if (bTmuxAfter) {
    violations.push(
      `cleanup-isolation: B-SIDE VIOLATED — B's tmux session ${built.tmux.b} is still live after its own teardown`,
    );
  }
  if (bListenAfter) {
    violations.push(
      `cleanup-isolation: B-SIDE VIOLATED — B's ttyd port ${built.ttyd.b.port} is still LISTENING after its own teardown`,
    );
  }
  if (!bPidGone) {
    violations.push(
      `cleanup-isolation: B-SIDE VIOLATED — B's ttyd pid ${bPidBefore} did not exit within ${KILL_TIMEOUT_MS}ms of its own teardown`,
    );
  }

  // 6. ANSWERABILITY — the criterion's named bar, not merely "still present".
  const postMarkerA = `cleanup-isolation-post-a-${built.port}-${randomBytes(4).toString("hex")}`;
  await writePaneMarker(built.tmux.a, built.home, postMarkerA);
  const postReadA = await readPaneThroughProxy({
    port: built.port,
    idSegment: built.sessionA.id,
    expect: postMarkerA,
    timeoutMs: PROXY_READ_TIMEOUT_MS,
  });
  console.log(
    `cleanup-isolation: ANSWERABILITY — A after B's teardown: opened=${postReadA.opened} ` +
      `containsNewToken=${postReadA.text.includes(postMarkerA)} containsBsToken=${postReadA.text.includes(preMarkerB)}`,
  );
  if (!postReadA.opened || !postReadA.text.includes(postMarkerA)) {
    violations.push(
      `cleanup-isolation: ANSWERABILITY VIOLATED — A did not answer a fresh prompt typed into its real ` +
        `pane after B's teardown (opened=${postReadA.opened}, token "${postMarkerA}" found=${postReadA.text.includes(postMarkerA)})`,
    );
  }
  if (postReadA.text.includes(preMarkerB)) {
    violations.push(
      `cleanup-isolation: ANSWERABILITY VIOLATED — A's own proxy path served B's earlier token ` +
        `"${preMarkerB}" — a pane read returning the wrong session's content is a routing failure wearing a success`,
    );
  }

  // 7. BRANCHES (criterion 5, first half).
  const { stdout: branchOutAfter } = await execFileP(
    "git",
    ["branch", "--list"],
    { cwd: built.repoPath },
  );
  console.log(
    `cleanup-isolation: BRANCHES after teardown — ${branchOutAfter
      .trim()
      .split("\n")
      .map((l) => l.trim())
      .join(" | ")}`,
  );
  if (!branchOutAfter.includes(built.branches.a)) {
    violations.push(
      `cleanup-isolation: BRANCH VIOLATED — A's branch ${built.branches.a} missing from \`git branch --list\` after B's teardown`,
    );
  }
  if (!branchOutAfter.includes(built.branches.b)) {
    violations.push(
      `cleanup-isolation: BRANCH VIOLATED — B's branch ${built.branches.b} missing from \`git branch --list\` after ` +
        `its own teardown — branches must survive every cleanup path`,
    );
  }

  // 8. Persisted store read.
  const finalCard = readCard(built.dbPath, built.cardId);
  const bStillPresent = finalCard?.sessions?.some(
    (s) => s.id === built.sessionB.id,
  );
  const aFinal = finalCard?.sessions?.find((s) => s.id === built.sessionA.id);
  console.log(
    `cleanup-isolation: STORE — sessions=${JSON.stringify((finalCard?.sessions ?? []).map((s) => s.id))} ` +
      `activeSessionId=${finalCard?.activeSessionId}`,
  );
  if (bStillPresent) {
    violations.push(
      `cleanup-isolation: STORE VIOLATED — B's session record is still present in sessions[] after a successful teardown`,
    );
  }
  if (finalCard?.activeSessionId !== built.sessionA.id) {
    violations.push(
      `cleanup-isolation: STORE VIOLATED — activeSessionId expected ${built.sessionA.id} (A), actual ${finalCard?.activeSessionId}`,
    );
  }
  if (aFinal) {
    if (finalCard.tmuxSession !== aFinal.tmuxSession) {
      violations.push(
        `cleanup-isolation: STORE VIOLATED — card-level tmuxSession (${finalCard.tmuxSession}) does not mirror A's own record (${aFinal.tmuxSession})`,
      );
    }
    if (finalCard.workspacePath !== aFinal.workspacePath) {
      violations.push(
        `cleanup-isolation: STORE VIOLATED — card-level workspacePath (${finalCard.workspacePath}) does not mirror A's own record (${aFinal.workspacePath})`,
      );
    }
    if (finalCard.ttydPort !== aFinal.ttydPort) {
      violations.push(
        `cleanup-isolation: STORE VIOLATED — card-level ttydPort (${finalCard.ttydPort}) does not mirror A's own record (${aFinal.ttydPort})`,
      );
    }
  } else {
    violations.push(
      `cleanup-isolation: STORE VIOLATED — A's own session record is missing from the persisted card entirely`,
    );
  }

  // NEW-14 ordering by CONSEQUENCE (criterion 5, second half) — see this function's own @remarks.
  const aPidBeforeRestart = (await pidsListeningOnPort(built.ttyd.a.port))[0];
  await restartServer(built);
  await sleep(1_000); // let reconcileSessions()/adoptAndSweep settle post-boot
  const bListeningAfterRestart = await isPortListening(built.ttyd.b.port);
  const bArgvAfterRestart = await psScanContains(
    `/sessions/${built.sessionB.id}/terminal`,
  );
  const aPidAfterRestart = (await pidsListeningOnPort(built.ttyd.a.port))[0];
  console.log(
    `cleanup-isolation: DELETE-BEFORE-KILL — after restart, B port ${built.ttyd.b.port} listening=${bListeningAfterRestart}, ` +
      `any ttyd argv carrying B's session id=${bArgvAfterRestart}, A pid before=${aPidBeforeRestart} after=${aPidAfterRestart}`,
  );
  if (bListeningAfterRestart) {
    violations.push(
      `cleanup-isolation: DELETE-BEFORE-KILL VIOLATED — B's ttyd port ${built.ttyd.b.port} is LISTENING ` +
        `again after a restart — a cleaned session's ttyd must never be re-adopted or respawned`,
    );
  }
  if (bArgvAfterRestart) {
    violations.push(
      `cleanup-isolation: DELETE-BEFORE-KILL VIOLATED — a ttyd process carrying B's session id ` +
        `(${built.sessionB.id}) in its argv exists after a restart`,
    );
  }
  if (aPidBeforeRestart == null || aPidAfterRestart !== aPidBeforeRestart) {
    violations.push(
      `cleanup-isolation: DELETE-BEFORE-KILL — A's ttyd pid changed across the restart (before=${aPidBeforeRestart}, ` +
        `after=${aPidAfterRestart}) — expected RE-ADOPTION with the SAME pid, the same behaviour --check orphan-sweep already establishes for a spared session`,
    );
  }

  const registeredAfterRestart = await gitWorktreeListRegistered(
    built.repoPath,
  );
  const aRegisteredAfterRestart =
    existsSync(aWt) && registeredAfterRestart.has(realpathSync(aWt));
  console.log(
    `cleanup-isolation: PRUNE-LAST scoping — A's registration in the shared repo survives B's prune=${aRegisteredAfterRestart}`,
  );
  if (!aRegisteredAfterRestart) {
    violations.push(
      `cleanup-isolation: PRUNE-LAST VIOLATED — A's registration in the shared repo ${built.repoPath} did not survive B's teardown/prune`,
    );
  }

  return violations;
}

/**
 * `--check cleanup-isolation` (Phase 93 criteria 1 and 5): two independent fixture cycles, exactly
 * the shape {@link checkReconcile} already established for a multi-stage check within one
 * invocation. Stage 1 ({@link checkCleanupIsolationFanout}) is a preliminary sanity leg proving the
 * manual fan-out reaches every session on a clean, fully-due card. Stage 2
 * ({@link checkCleanupIsolationScheduler}) is the actual isolation claim, run against a FRESH
 * fixture so stage 1's full teardown of both sessions cannot contaminate it: only session B is
 * seeded due, dispatched by the real scheduler, and the sibling's answerability, worktree
 * registration, branch survival and NEW-14-by-consequence ordering are all asserted there.
 */
async function checkCleanupIsolation() {
  return [
    ...(await withFixture(
      "cleanup-isolation-fanout",
      checkCleanupIsolationFanout,
      WORKTREE_FIXTURE,
    )),
    ...(await withFixture(
      "cleanup-isolation",
      checkCleanupIsolationScheduler,
      WORKTREE_FIXTURE,
    )),
  ];
}

/**
 * Write an uncommitted modification into the fixture's own already-committed tracked file
 * (`session-<key>.txt`, seeded by {@link standUpFixture}) so the session's worktree is genuinely
 * dirty under `git status --porcelain` — a modified TRACKED file, never a new untracked one, so the
 * dirtiness is unambiguous "uncommitted work", the exact subject the criterion protects.
 */
function dirtyWorktree(built, key) {
  const wtPath = built.worktreePaths[key];
  writeFileSync(
    join(wtPath, `session-${key}.txt`),
    "uncommitted change from cleanup-refusal check\n",
    { flag: "a" },
  );
}

/**
 * `git -C <worktreePath> status --porcelain` line count — the exact read `worktreeStatus`
 * (`git.ts`) itself performs, so a fixture's own dirty/clean precondition is asserted through the
 * mechanism `cleanupWorkspace`'s preflight consults, never a proxy for it.
 */
async function porcelainLineCount(worktreePath) {
  const { stdout } = await execFileP("git", ["status", "--porcelain"], {
    cwd: worktreePath,
  });
  return stdout.split("\n").filter((l) => l.trim() !== "").length;
}

/**
 * `--check cleanup-refusal` direction 1 of 2 (Phase 93 criterion 3, T-93-23): a dirty sibling must
 * NOT block a clean session's teardown. Session A is made dirty and left alone (never seeded due);
 * session B is left clean and is the ONLY session seeded past-due, dispatched by the real scheduler
 * exactly the way {@link checkCleanupIsolationScheduler} drives criterion 1 — a misaddressed
 * preflight that lets A's own dirtiness leak into B's check is precisely what this direction exists
 * to catch. Stashes `{ bTornDown, bRefused }` onto `outcome` so the combining check
 * ({@link checkCleanupRefusal}) can assert the cross-direction "exactly one torn down, exactly one
 * refused" claim after both directions have each run in their own fresh fixture.
 */
async function checkCleanupRefusalDirection1(built, outcome) {
  const violations = [];
  const aWt = built.worktreePaths.a;
  const bWt = built.worktreePaths.b;

  dirtyWorktree(built, "a");
  const aDirtyCount = await porcelainLineCount(aWt);
  const bDirtyCount = await porcelainLineCount(bWt);
  console.log(
    `cleanup-refusal: direction 1 PRECONDITION — A porcelain lines=${aDirtyCount} (expect >0), B porcelain lines=${bDirtyCount} (expect 0)`,
  );
  if (aDirtyCount === 0 || bDirtyCount !== 0) {
    violations.push(
      `cleanup-refusal: direction 1 PRECONDITION FAILED — A must be dirty (got ${aDirtyCount}) and B must be clean (got ${bDirtyCount}) before anything destructive runs`,
    );
    return violations;
  }

  const moveStatus = await moveCard(built, "done");
  console.log(
    `cleanup-refusal: direction 1 — POST /move to done -> ${moveStatus} (expected 204)`,
  );
  if (moveStatus !== 204) {
    violations.push(
      `cleanup-refusal: direction 1 — POST /move to done returned ${moveStatus}, expected 204`,
    );
    return violations;
  }
  await killAndWait(built.server?.child);
  const cardAtDone = readCard(built.dbPath, built.cardId);
  const aRecordAtDone = cardAtDone?.sessions?.find(
    (s) => s.id === built.sessionA.id,
  );
  const bRecordAtDone = cardAtDone?.sessions?.find(
    (s) => s.id === built.sessionB.id,
  );
  if (
    !cardAtDone ||
    cardAtDone.column !== "done" ||
    !aRecordAtDone ||
    !bRecordAtDone
  ) {
    violations.push(
      `cleanup-refusal: direction 1 — persisted card missing at Done arrival (column=${cardAtDone?.column}, a=${!!aRecordAtDone}, b=${!!bRecordAtDone})`,
    );
    return violations;
  }
  bRecordAtDone.cleanupDueAt = Date.now() - 5_000;
  seedFixtureCard(built.home, cardAtDone);
  console.log(
    `cleanup-refusal: direction 1 — seeded ONLY B's (clean) cleanupDueAt past-due; A's (dirty) is left untouched, never due`,
  );

  const priorTickEnv = process.env.DISPATCH_CLEANUP_TICK_MS;
  process.env.DISPATCH_CLEANUP_TICK_MS = "500";
  try {
    built.server = bootServer(built.home);
    await waitForReady(built.port);
  } finally {
    if (priorTickEnv === undefined) delete process.env.DISPATCH_CLEANUP_TICK_MS;
    else process.env.DISPATCH_CLEANUP_TICK_MS = priorTickEnv;
  }

  const deadline = Date.now() + CLEANUP_ISOLATION_SETTLE_TIMEOUT_MS;
  let settledCard;
  let bGone = false;
  while (Date.now() < deadline) {
    settledCard = readCard(built.dbPath, built.cardId);
    bGone =
      settledCard != null &&
      !(settledCard.sessions ?? []).some((s) => s.id === built.sessionB.id);
    if (bGone) break;
    await sleep(POLL_INTERVAL_MS);
  }
  console.log(
    `cleanup-refusal: direction 1 — scheduler settle: B gone=${bGone} within ${CLEANUP_ISOLATION_SETTLE_TIMEOUT_MS}ms`,
  );
  outcome.bTornDown = bGone;
  if (!bGone) {
    violations.push(
      `cleanup-refusal: direction 1 — session B (clean) was not torn down by the real scheduler within ${CLEANUP_ISOLATION_SETTLE_TIMEOUT_MS}ms — a dirty sibling must never block a clean session's teardown`,
    );
  }

  const registered = await gitWorktreeListRegistered(built.repoPath);
  const bRegisteredAfter = existsSync(bWt) && registered.has(realpathSync(bWt));
  const bDirAfter = existsSync(bWt);
  const liveAfter = await tmuxListSessionNames();
  const bTmuxAfter = liveAfter.includes(built.tmux.b);
  const bListenAfter = await isPortListening(built.ttyd.b.port);
  console.log(
    `cleanup-refusal: direction 1 — B-SIDE (clean target) registered=${bRegisteredAfter} dir=${bDirAfter} tmux=${bTmuxAfter} ttyd=${bListenAfter}`,
  );
  if (bRegisteredAfter || bDirAfter || bTmuxAfter || bListenAfter) {
    violations.push(
      `cleanup-refusal: direction 1 — B-SIDE VIOLATED, B should have been fully torn down (registered=${bRegisteredAfter} dir=${bDirAfter} tmux=${bTmuxAfter} ttyd=${bListenAfter})`,
    );
  }
  const bFinalRecord = settledCard?.sessions?.find(
    (s) => s.id === built.sessionB.id,
  );
  outcome.bRefused = Boolean(bFinalRecord?.cleanupBlocked?.length);
  if (bFinalRecord) {
    violations.push(
      `cleanup-refusal: direction 1 — B-SIDE VIOLATED, B's session record is still present after a successful teardown`,
    );
  }
  if (outcome.bRefused) {
    violations.push(
      `cleanup-refusal: direction 1 — B was refused (cleanupBlocked=${JSON.stringify(bFinalRecord?.cleanupBlocked)}) despite being clean — a dirty sibling must never block a clean session's teardown`,
    );
  }
  if (settledCard?.cleanupBlocked?.length) {
    violations.push(
      `cleanup-refusal: direction 1 — card-level cleanupBlocked is set (${JSON.stringify(settledCard.cleanupBlocked)}) though nothing should have been refused`,
    );
  }

  const aRegisteredAfter = existsSync(aWt) && registered.has(realpathSync(aWt));
  const aDirAfter = existsSync(aWt);
  const aTmuxAfter = liveAfter.includes(built.tmux.a);
  const aListenAfter = await isPortListening(built.ttyd.a.port);
  const aDirtyAfter = existsSync(aWt) ? await porcelainLineCount(aWt) : 0;
  const aFinalRecord = settledCard?.sessions?.find(
    (s) => s.id === built.sessionA.id,
  );
  console.log(
    `cleanup-refusal: direction 1 — A-SIDE (dirty sibling, untouched) registered=${aRegisteredAfter} dir=${aDirAfter} tmux=${aTmuxAfter} ttyd=${aListenAfter} porcelainLines=${aDirtyAfter} recordPresent=${!!aFinalRecord}`,
  );
  if (
    !aRegisteredAfter ||
    !aDirAfter ||
    !aTmuxAfter ||
    !aListenAfter ||
    aDirtyAfter === 0 ||
    !aFinalRecord
  ) {
    violations.push(
      `cleanup-refusal: direction 1 — A-SIDE VIOLATED, the dirty sibling was touched by cleaning B (registered=${aRegisteredAfter} dir=${aDirAfter} tmux=${aTmuxAfter} ttyd=${aListenAfter} porcelainLines=${aDirtyAfter} recordPresent=${!!aFinalRecord})`,
    );
  }

  return violations;
}

/**
 * `--check cleanup-refusal` direction 2 of 2 (Phase 93 criterion 3, T-93-22): a clean sibling must
 * NOT cause a dirty session to be torn down. Runs in a FRESH fixture cycle — never direction 1's
 * already-mutated one — so session A starts dirty again and is the ONLY session seeded past-due;
 * session B stays clean and untouched. Proves the zero-teardown `recordCleanupBlocked` contract on
 * disk (not just in the store) AND that the refusal names its subject — the resolved session's own
 * `cleanupBlocked` and the wire's `sessionSummaries[].cleanupBlocked` at that session's own
 * `ordinal`.
 */
async function checkCleanupRefusalDirection2(built, outcome) {
  const violations = [];
  const aWt = built.worktreePaths.a;
  const bWt = built.worktreePaths.b;

  dirtyWorktree(built, "a");
  const aDirtyCountBefore = await porcelainLineCount(aWt);
  const bDirtyCount = await porcelainLineCount(bWt);
  console.log(
    `cleanup-refusal: direction 2 PRECONDITION — A porcelain lines=${aDirtyCountBefore} (expect >0), B porcelain lines=${bDirtyCount} (expect 0)`,
  );
  if (aDirtyCountBefore === 0 || bDirtyCount !== 0) {
    violations.push(
      `cleanup-refusal: direction 2 PRECONDITION FAILED — A must be dirty (got ${aDirtyCountBefore}) and B must be clean (got ${bDirtyCount}) before anything destructive runs`,
    );
    return violations;
  }

  const moveStatus = await moveCard(built, "done");
  console.log(
    `cleanup-refusal: direction 2 — POST /move to done -> ${moveStatus} (expected 204)`,
  );
  if (moveStatus !== 204) {
    violations.push(
      `cleanup-refusal: direction 2 — POST /move to done returned ${moveStatus}, expected 204`,
    );
    return violations;
  }
  await killAndWait(built.server?.child);
  const cardAtDone = readCard(built.dbPath, built.cardId);
  const aRecordAtDone = cardAtDone?.sessions?.find(
    (s) => s.id === built.sessionA.id,
  );
  const bRecordAtDone = cardAtDone?.sessions?.find(
    (s) => s.id === built.sessionB.id,
  );
  if (
    !cardAtDone ||
    cardAtDone.column !== "done" ||
    !aRecordAtDone ||
    !bRecordAtDone
  ) {
    violations.push(
      `cleanup-refusal: direction 2 — persisted card missing at Done arrival (column=${cardAtDone?.column}, a=${!!aRecordAtDone}, b=${!!bRecordAtDone})`,
    );
    return violations;
  }
  aRecordAtDone.cleanupDueAt = Date.now() - 5_000;
  seedFixtureCard(built.home, cardAtDone);
  console.log(
    `cleanup-refusal: direction 2 — seeded ONLY A's (dirty) cleanupDueAt past-due; B's (clean) is left untouched, never due`,
  );

  const priorTickEnv = process.env.DISPATCH_CLEANUP_TICK_MS;
  process.env.DISPATCH_CLEANUP_TICK_MS = "500";
  try {
    built.server = bootServer(built.home);
    await waitForReady(built.port);
  } finally {
    if (priorTickEnv === undefined) delete process.env.DISPATCH_CLEANUP_TICK_MS;
    else process.env.DISPATCH_CLEANUP_TICK_MS = priorTickEnv;
  }

  const deadline = Date.now() + CLEANUP_ISOLATION_SETTLE_TIMEOUT_MS;
  let settledCard;
  let aBlocked = false;
  while (Date.now() < deadline) {
    settledCard = readCard(built.dbPath, built.cardId);
    const aRecord = settledCard?.sessions?.find(
      (s) => s.id === built.sessionA.id,
    );
    aBlocked = Boolean(aRecord?.cleanupBlocked?.length);
    if (aBlocked) break;
    await sleep(POLL_INTERVAL_MS);
  }
  console.log(
    `cleanup-refusal: direction 2 — scheduler settle: A refused=${aBlocked} within ${CLEANUP_ISOLATION_SETTLE_TIMEOUT_MS}ms`,
  );
  outcome.aRefused = aBlocked;
  if (!aBlocked) {
    violations.push(
      `cleanup-refusal: direction 2 — session A (dirty) was NOT refused by the real scheduler within ${CLEANUP_ISOLATION_SETTLE_TIMEOUT_MS}ms — a dirty session must never be torn down`,
    );
  }

  const registered = await gitWorktreeListRegistered(built.repoPath);
  const aRegisteredAfter = existsSync(aWt) && registered.has(realpathSync(aWt));
  const aDirAfter = existsSync(aWt);
  const liveAfter = await tmuxListSessionNames();
  const aTmuxAfter = liveAfter.includes(built.tmux.a);
  const aListenAfter = await isPortListening(built.ttyd.a.port);
  const aDirtyCountAfter = existsSync(aWt) ? await porcelainLineCount(aWt) : 0;
  const aFinalRecord = settledCard?.sessions?.find(
    (s) => s.id === built.sessionA.id,
  );
  outcome.aTornDown = !aFinalRecord;
  console.log(
    `cleanup-refusal: direction 2 — A-SIDE (dirty target) registered=${aRegisteredAfter} dir=${aDirAfter} tmux=${aTmuxAfter} ttyd=${aListenAfter} porcelainLines=${aDirtyCountAfter} recordPresent=${!!aFinalRecord}`,
  );
  if (
    !aRegisteredAfter ||
    !aDirAfter ||
    !aTmuxAfter ||
    !aListenAfter ||
    !aFinalRecord
  ) {
    violations.push(
      `cleanup-refusal: direction 2 — A-SIDE VIOLATED, the dirty target was torn down instead of refused (registered=${aRegisteredAfter} dir=${aDirAfter} tmux=${aTmuxAfter} ttyd=${aListenAfter} recordPresent=${!!aFinalRecord})`,
    );
  }
  if (aDirtyCountAfter !== aDirtyCountBefore) {
    violations.push(
      `cleanup-refusal: direction 2 — A-SIDE VIOLATED, A's uncommitted change count changed from ${aDirtyCountBefore} to ${aDirtyCountAfter} — a refused worktree must be left exactly as it was`,
    );
  }

  const expectedRepo = basename(built.repoPath);
  const blockedEntry = aFinalRecord?.cleanupBlocked?.find(
    (b) => b.repo === expectedRepo,
  );
  console.log(
    `cleanup-refusal: direction 2 — REFUSAL naming (record) — cleanupBlocked=${JSON.stringify(aFinalRecord?.cleanupBlocked)}, expected repo=${expectedRepo} count=${aDirtyCountBefore}`,
  );
  if (!blockedEntry || blockedEntry.count !== aDirtyCountBefore) {
    violations.push(
      `cleanup-refusal: direction 2 — REFUSAL VIOLATED on the session record: expected cleanupBlocked to name repo "${expectedRepo}" with count ${aDirtyCountBefore}, got ${JSON.stringify(aFinalRecord?.cleanupBlocked)}`,
    );
  }

  const wireCard = await fetchFixtureCard(built);
  const wireSummary = wireCard?.sessionSummaries?.find(
    (s) => s.id === built.sessionA.id,
  );
  console.log(
    `cleanup-refusal: direction 2 — REFUSAL naming (wire) — sessionSummaries entry for A: ${JSON.stringify(wireSummary)}`,
  );
  const wireEntry = wireSummary?.cleanupBlocked?.find(
    (b) => b.repo === expectedRepo,
  );
  if (
    !wireSummary ||
    wireSummary.ordinal == null ||
    !wireEntry ||
    wireEntry.count !== aDirtyCountBefore
  ) {
    violations.push(
      `cleanup-refusal: direction 2 — REFUSAL VIOLATED on the wire: GET /api/board's sessionSummaries entry for A (ordinal=${wireSummary?.ordinal}) is missing a cleanupBlocked entry naming repo "${expectedRepo}" with count ${aDirtyCountBefore}, got ${JSON.stringify(wireSummary)}`,
    );
  }

  const bRegisteredAfter = existsSync(bWt) && registered.has(realpathSync(bWt));
  const bDirAfter = existsSync(bWt);
  const bTmuxAfter = liveAfter.includes(built.tmux.b);
  const bListenAfter = await isPortListening(built.ttyd.b.port);
  const bFinalRecord = settledCard?.sessions?.find(
    (s) => s.id === built.sessionB.id,
  );
  console.log(
    `cleanup-refusal: direction 2 — B-SIDE (clean sibling, untouched) registered=${bRegisteredAfter} dir=${bDirAfter} tmux=${bTmuxAfter} ttyd=${bListenAfter} recordPresent=${!!bFinalRecord} cleanupBlocked=${JSON.stringify(bFinalRecord?.cleanupBlocked)}`,
  );
  if (
    !bRegisteredAfter ||
    !bDirAfter ||
    !bTmuxAfter ||
    !bListenAfter ||
    !bFinalRecord ||
    bFinalRecord.cleanupBlocked?.length
  ) {
    violations.push(
      `cleanup-refusal: direction 2 — B-SIDE VIOLATED, the clean sibling was touched while cleaning dirty A (registered=${bRegisteredAfter} dir=${bDirAfter} tmux=${bTmuxAfter} ttyd=${bListenAfter} recordPresent=${!!bFinalRecord} cleanupBlocked=${JSON.stringify(bFinalRecord?.cleanupBlocked)})`,
    );
  }

  return violations;
}

/**
 * `--check cleanup-refusal` fan-out partial-failure case (Phase 93 criterion 3, T-93-25): the
 * user's decision that the manual Clean up button tears down EVERY session on a card means a
 * single click on a card with one dirty and one clean session must tear down the clean one and
 * refuse the dirty one IN THE SAME CLICK, without the refusal aborting the sibling that already
 * succeeded. Fresh fixture: A dirty, B clean, ONE `POST /cleanup {force:false}` (never the
 * scheduler) fires the fan-out `runCleanupFanOut` (93-04) drives sequentially with a per-session
 * try/catch — the reason a blocked/warned outcome is a terminal RETURN inside `cleanupWorkspace`
 * rather than a throw.
 */
async function checkCleanupRefusalFanout(built) {
  const violations = [];
  const aWt = built.worktreePaths.a;
  const bWt = built.worktreePaths.b;

  dirtyWorktree(built, "a");
  const aDirtyCountBefore = await porcelainLineCount(aWt);
  const bDirtyCount = await porcelainLineCount(bWt);
  console.log(
    `cleanup-refusal: fan-out PRECONDITION — A porcelain lines=${aDirtyCountBefore} (expect >0), B porcelain lines=${bDirtyCount} (expect 0)`,
  );
  if (aDirtyCountBefore === 0 || bDirtyCount !== 0) {
    violations.push(
      `cleanup-refusal: fan-out PRECONDITION FAILED — A must be dirty (got ${aDirtyCountBefore}) and B must be clean (got ${bDirtyCount}) before anything destructive runs`,
    );
    return violations;
  }

  const moveStatus = await moveCard(built, "done");
  console.log(
    `cleanup-refusal: fan-out — POST /move to done -> ${moveStatus} (expected 204)`,
  );
  if (moveStatus !== 204) {
    violations.push(
      `cleanup-refusal: fan-out — POST /move to done returned ${moveStatus}, expected 204`,
    );
    return violations;
  }

  const cleanupStatus = await postCleanup(built, { force: false });
  console.log(
    `cleanup-refusal: fan-out — ONE POST /cleanup {force:false} -> ${cleanupStatus} (expected 202)`,
  );
  if (cleanupStatus !== 202) {
    violations.push(
      `cleanup-refusal: fan-out — POST /cleanup returned ${cleanupStatus}, expected 202`,
    );
    return violations;
  }

  const deadline = Date.now() + CLEANUP_ISOLATION_SETTLE_TIMEOUT_MS;
  let settledCard;
  let settled = false;
  while (Date.now() < deadline) {
    settledCard = readCard(built.dbPath, built.cardId);
    const bPresent = (settledCard?.sessions ?? []).some(
      (s) => s.id === built.sessionB.id,
    );
    const aRecord = settledCard?.sessions?.find(
      (s) => s.id === built.sessionA.id,
    );
    settled = !bPresent && Boolean(aRecord?.cleanupBlocked?.length);
    if (settled) break;
    await sleep(POLL_INTERVAL_MS);
  }
  console.log(
    `cleanup-refusal: fan-out — settle: B gone AND A refused = ${settled} within ${CLEANUP_ISOLATION_SETTLE_TIMEOUT_MS}ms`,
  );
  if (!settled) {
    violations.push(
      `cleanup-refusal: fan-out — the single-click fan-out did not settle into "B torn down, A refused" within ${CLEANUP_ISOLATION_SETTLE_TIMEOUT_MS}ms — final sessions=${JSON.stringify(
        (settledCard?.sessions ?? []).map((s) => ({
          id: s.id,
          cleanupBlocked: s.cleanupBlocked,
        })),
      )}`,
    );
  }

  const registered = await gitWorktreeListRegistered(built.repoPath);
  const bRegisteredAfter = existsSync(bWt) && registered.has(realpathSync(bWt));
  const bDirAfter = existsSync(bWt);
  const liveAfter = await tmuxListSessionNames();
  const bTmuxAfter = liveAfter.includes(built.tmux.b);
  const bListenAfter = await isPortListening(built.ttyd.b.port);
  const bFinalRecord = settledCard?.sessions?.find(
    (s) => s.id === built.sessionB.id,
  );
  console.log(
    `cleanup-refusal: fan-out — B (clean) settled state: registered=${bRegisteredAfter} dir=${bDirAfter} tmux=${bTmuxAfter} ttyd=${bListenAfter} recordPresent=${!!bFinalRecord}`,
  );
  if (
    bRegisteredAfter ||
    bDirAfter ||
    bTmuxAfter ||
    bListenAfter ||
    bFinalRecord
  ) {
    violations.push(
      `cleanup-refusal: fan-out — B was not fully torn down by the fan-out (registered=${bRegisteredAfter} dir=${bDirAfter} tmux=${bTmuxAfter} ttyd=${bListenAfter} recordPresent=${!!bFinalRecord})`,
    );
  }

  const aRegisteredAfter = existsSync(aWt) && registered.has(realpathSync(aWt));
  const aDirAfter = existsSync(aWt);
  const aTmuxAfter = liveAfter.includes(built.tmux.a);
  const aListenAfter = await isPortListening(built.ttyd.a.port);
  const aFinalRecord = settledCard?.sessions?.find(
    (s) => s.id === built.sessionA.id,
  );
  const expectedRepo = basename(built.repoPath);
  const aBlockedEntry = aFinalRecord?.cleanupBlocked?.find(
    (b) => b.repo === expectedRepo,
  );
  console.log(
    `cleanup-refusal: fan-out — A (dirty) settled state: registered=${aRegisteredAfter} dir=${aDirAfter} tmux=${aTmuxAfter} ttyd=${aListenAfter} recordPresent=${!!aFinalRecord} cleanupBlocked=${JSON.stringify(aFinalRecord?.cleanupBlocked)}`,
  );
  if (
    !aRegisteredAfter ||
    !aDirAfter ||
    !aTmuxAfter ||
    !aListenAfter ||
    !aFinalRecord ||
    !aBlockedEntry
  ) {
    violations.push(
      `cleanup-refusal: fan-out — A-SIDE VIOLATED, the dirty session must stay fully alive and blocked, naming its own repo (registered=${aRegisteredAfter} dir=${aDirAfter} tmux=${aTmuxAfter} ttyd=${aListenAfter} recordPresent=${!!aFinalRecord} cleanupBlocked=${JSON.stringify(aFinalRecord?.cleanupBlocked)})`,
    );
  }

  console.log(
    `cleanup-refusal: fan-out — settled side by side: B={torn down=${!bFinalRecord}} A={alive=${!!aFinalRecord}, blocked=${JSON.stringify(aFinalRecord?.cleanupBlocked)}}`,
  );

  if (settledCard?.activeSessionId !== built.sessionA.id) {
    violations.push(
      `cleanup-refusal: fan-out — card.activeSessionId (${settledCard?.activeSessionId}) does not resolve to A's present record after the fan-out`,
    );
  }

  const wireCard = await fetchFixtureCard(built);
  console.log(
    `cleanup-refusal: fan-out — wire N=1 shape: sessionSummaries=${JSON.stringify(wireCard?.sessionSummaries)} card.cleanupBlocked=${JSON.stringify(wireCard?.cleanupBlocked)}`,
  );
  if (wireCard?.sessionSummaries !== undefined) {
    violations.push(
      `cleanup-refusal: fan-out — wire VIOLATED, sessionSummaries should be ABSENT once only one session remains (N=1), got ${JSON.stringify(wireCard.sessionSummaries)}`,
    );
  }
  const cardWireBlockedEntry = wireCard?.cleanupBlocked?.find(
    (b) => b.repo === expectedRepo,
  );
  if (!cardWireBlockedEntry) {
    violations.push(
      `cleanup-refusal: fan-out — wire VIOLATED, card-level cleanupBlocked (the active-session mirror) should carry A's refusal naming repo "${expectedRepo}", got ${JSON.stringify(wireCard?.cleanupBlocked)}`,
    );
  }

  return violations;
}

/**
 * `--check cleanup-refusal` (Phase 93 criterion 3): three independent fixture cycles — the two
 * cross-contamination directions plus the fan-out partial-failure case the user's "clean up tears
 * down every session" decision created — combined into one `--check` invocation, matching the shape
 * {@link checkCleanupIsolation} already established. The two directions run in SEPARATE fresh
 * fixtures (direction 2 must not inherit direction 1's own mutated state); their outcomes are
 * combined into the single cross-direction assertion that makes the pair a criterion rather than two
 * half-checks — "across both directions, exactly one session was torn down and exactly one was
 * refused" — which no single direction's own violations list can express on its own.
 */
async function checkCleanupRefusal() {
  const outcome1 = {};
  const violations1 = await withFixture(
    "cleanup-refusal-direction1",
    (built) => checkCleanupRefusalDirection1(built, outcome1),
    WORKTREE_FIXTURE,
  );
  const outcome2 = {};
  const violations2 = await withFixture(
    "cleanup-refusal-direction2",
    (built) => checkCleanupRefusalDirection2(built, outcome2),
    WORKTREE_FIXTURE,
  );

  const tornDownCount =
    (outcome1.bTornDown ? 1 : 0) + (outcome2.aTornDown ? 1 : 0);
  const refusedCount =
    (outcome1.bRefused ? 1 : 0) + (outcome2.aRefused ? 1 : 0);
  console.log(
    `cleanup-refusal: CROSS-DIRECTION — direction1(B) tornDown=${outcome1.bTornDown} refused=${outcome1.bRefused}; direction2(A) tornDown=${outcome2.aTornDown} refused=${outcome2.aRefused}; totals tornDown=${tornDownCount} refused=${refusedCount}`,
  );
  const crossViolations = [];
  if (tornDownCount !== 1 || refusedCount !== 1) {
    crossViolations.push(
      `cleanup-refusal: CROSS-DIRECTION VIOLATED — expected exactly one session torn down and exactly one refused across both directions, got tornDown=${tornDownCount} refused=${refusedCount}`,
    );
  }

  const outcome3 = {};
  const violations3 = await withFixture(
    "cleanup-refusal-fanout",
    (built) => checkCleanupRefusalFanout(built, outcome3),
    WORKTREE_FIXTURE,
  );

  return [...violations1, ...violations2, ...crossViolations, ...violations3];
}

/**
 * A single-session profile that still owns a REAL git worktree ({@link WORKTREE_FIXTURE}'s own
 * port/tmux namespace, since every worktree check already runs its own fixture cycles
 * sequentially, never concurrently, within one `--check` invocation). Branches 1-4 and the
 * scheduler's own pre-dispatch legs (Phase 93 criterion 4) only ever need ONE session — the
 * `LAST-SESSION` promotion case needs exactly this shape too.
 */
const CLEANUP_BRANCH_SINGLE_FIXTURE = {
  port: WORKTREE_SANDBOX_PORT,
  tmuxPrefix: WORKTREE_TMUX_PREFIX,
  sessionKeys: ["a"],
  worktrees: true,
};

const CLEANUP_TS_PATH = join(
  REPO_ROOT,
  "src",
  "server",
  "services",
  "orchestration",
  "cleanup.ts",
);

/** The four store method NAMES `cleanupWorkspace` calls terminally — `recordCleanupWarning` fires from TWO distinct sites. */
const CLEANUP_TERMINAL_METHODS = [
  "recordCleanupBlocked",
  "noteCleanupWarning",
  "recordCleanupWarning",
  "finishCleanup",
];

/**
 * Strip `/* ... *\/` (including JSDoc `/** ... *\/`) and `// ...` comments from `src`, LINE BY LINE
 * so every surviving character keeps its ORIGINAL line number. A raw `grep -c` over uncommented
 * source would count the JSDoc that DESCRIBES the five branches (this file's own header, and
 * `cleanup.ts`'s own remarks) and make the enumeration assertion self-satisfying — exactly the trap
 * `93-07-PLAN.md`'s own Task 1 names. Not a full tokenizer (no string-literal awareness), but
 * `cleanup.ts` is verified to contain no `//`, `/*`, or `*\/` sequences inside any string/template
 * literal, so a line-oriented strip is exact for this specific file.
 */
function stripCommentsPerLine(src) {
  const lines = src.split("\n");
  let inBlock = false;
  return lines.map((line) => {
    let out = "";
    let i = 0;
    for (;;) {
      if (i >= line.length) return out;
      if (inBlock) {
        const end = line.indexOf("*/", i);
        if (end === -1) return out;
        inBlock = false;
        i = end + 2;
        continue;
      }
      const blockStart = line.indexOf("/*", i);
      const lineStart = line.indexOf("//", i);
      if (blockStart !== -1 && (lineStart === -1 || blockStart < lineStart)) {
        out += line.slice(i, blockStart);
        const end = line.indexOf("*/", blockStart + 2);
        if (end === -1) {
          inBlock = true;
          return out;
        }
        i = end + 2;
        continue;
      }
      if (lineStart !== -1) {
        out += line.slice(i, lineStart);
        return out;
      }
      out += line.slice(i);
      return out;
    }
  });
}

/**
 * The ENUMERATION assertion (Task 1): re-parse `cleanup.ts` FRESH from disk every run (never a
 * cached count), strip every comment, and count `store.<method>(` call sites for the four terminal
 * mutator names inside {@link CLEANUP_TERMINAL_METHODS} — `recordCleanupWarning` is expected TWICE
 * (the post-teardown-failure site and the legacy-workspace site SHARE the store method but are
 * DISTINCT code paths reached under different preconditions), the other three once each, for a
 * total of exactly FIVE. A count other than five means a branch was added or removed since this
 * check was written — that failure is the point, and it is what stops this check from going stale
 * the way `93-CONTEXT.md`'s own four-branch list did.
 */
function enumerateCleanupBranchesFromSource() {
  const violations = [];
  const raw = readFileSync(CLEANUP_TS_PATH, "utf8");
  const strippedLines = stripCommentsPerLine(raw);
  const hits = [];
  for (const method of CLEANUP_TERMINAL_METHODS) {
    const lineRe = new RegExp(`\\bstore\\.${method}\\s*\\(`, "g");
    strippedLines.forEach((line, idx) => {
      let m;
      while ((m = lineRe.exec(line)) !== null) {
        hits.push({ method, line: idx + 1 });
      }
    });
  }
  hits.sort((a, b) => a.line - b.line);
  console.log(
    `cleanup-branches: ENUMERATION — parsed ${CLEANUP_TS_PATH} (comments stripped) — ` +
      `${hits.length} terminal call site(s): ${hits.map((h) => `${h.method}:${h.line}`).join(", ")}`,
  );
  if (hits.length !== 5) {
    violations.push(
      `cleanup-branches: ENUMERATION VIOLATED — expected exactly 5 terminal store call sites inside ` +
        `cleanupWorkspace, found ${hits.length} (${hits.map((h) => `${h.method}:${h.line}`).join(", ")}) — ` +
        `a branch was added or removed since this check was written`,
    );
    return violations;
  }
  const byMethod = {};
  for (const h of hits) byMethod[h.method] = (byMethod[h.method] ?? 0) + 1;
  const expectedCounts = {
    recordCleanupBlocked: 1,
    noteCleanupWarning: 1,
    recordCleanupWarning: 2,
    finishCleanup: 1,
  };
  for (const [method, expected] of Object.entries(expectedCounts)) {
    const actual = byMethod[method] ?? 0;
    if (actual !== expected) {
      violations.push(
        `cleanup-branches: ENUMERATION VIOLATED — expected ${method} to appear ${expected} time(s), found ${actual}`,
      );
    }
  }
  return violations;
}

/**
 * The pointer invariant every branch below is read against directly on the PERSISTED store (never
 * the wire, which redacts `sessions`): an `activeSessionId` that is set always resolves to a
 * record present in `sessions`; an empty `sessions` array always carries an absent
 * `activeSessionId`; a non-empty `sessions` array always carries a set `activeSessionId`; and, when
 * the pointer resolves, the card's flat six-field mirror equals the resolved active record's own
 * values verbatim (JSON-compared, matching `board.store.ts#projectionDrifted`'s own `?? null` fold
 * so `undefined` and absent-field are never mistaken for drift).
 */
function assertPointerInvariant(card, label, violations) {
  if (!card) {
    violations.push(
      `cleanup-branches: ${label} — persisted card missing entirely`,
    );
    return;
  }
  const sessions = card.sessions ?? [];
  const active = sessions.find((s) => s.id === card.activeSessionId);
  console.log(
    `cleanup-branches: ${label} — POINTER sessions=${JSON.stringify(sessions.map((s) => s.id))} ` +
      `activeSessionId=${card.activeSessionId} resolves=${!!active}`,
  );
  if (card.activeSessionId != null && !active) {
    violations.push(
      `cleanup-branches: ${label} — POINTER VIOLATED, activeSessionId ${card.activeSessionId} does ` +
        `not resolve to any record in sessions=${JSON.stringify(sessions.map((s) => s.id))}`,
    );
  }
  if (sessions.length === 0 && card.activeSessionId != null) {
    violations.push(
      `cleanup-branches: ${label} — POINTER VIOLATED, sessions is empty but activeSessionId is ` +
        `${card.activeSessionId}, expected absent`,
    );
  }
  if (sessions.length > 0 && card.activeSessionId == null) {
    violations.push(
      `cleanup-branches: ${label} — POINTER VIOLATED, ${sessions.length} session record(s) present ` +
        `but activeSessionId is absent`,
    );
  }
  if (active) {
    const mirrorFields = [
      "tmuxSession",
      "ttydPort",
      "hookToken",
      "claudeSessionId",
      "workspacePath",
      "workspace",
    ];
    for (const field of mirrorFields) {
      const cardVal = JSON.stringify(card[field] ?? null);
      const sessionVal = JSON.stringify(active[field] ?? null);
      if (cardVal !== sessionVal) {
        violations.push(
          `cleanup-branches: ${label} — MIRROR VIOLATED, card.${field}=${cardVal} does not match ` +
            `the active session's own ${field}=${sessionVal}`,
        );
      }
    }
  }
}

/**
 * The exact admin directory `worktreePath`'s own `.git` POINTER FILE names (`gitdir: <path>`),
 * never assumed from the session key: `workspace-paths.ts#worktreePath` joins every session's
 * worktree leaf on `path.basename(repoPath)`, so with one shared fixture repo every session's leaf
 * is the SAME name (`alpha`) and git disambiguates the second registration with a numeric suffix —
 * reading the pointer file is the only way to find the real admin dir regardless of key or order.
 */
function worktreeAdminDir(worktreePath) {
  const pointer = readFileSync(join(worktreePath, ".git"), "utf8");
  const m = pointer.match(/gitdir:\s*(.+)/);
  if (!m) {
    throw new Error(
      `could not parse .git pointer file at ${worktreePath}: ${pointer}`,
    );
  }
  return m[1].trim();
}

/**
 * Corrupt the worktree's OWN admin `index` (inside the MAIN repo's `.git/worktrees/<name>/`, never
 * the worktree's own working files) with random bytes — `git status` on the worktree then fails
 * with `fatal: index file corrupt`, a stderr that names NEITHER of `worktreeStatus`'s two
 * `ORPHAN_STDERR` fragments (`"not a git repository"` / `"must be run in a work tree"`), so it
 * classifies as the non-orphan `kind: "error"` branch 2 needs. Empirically verified against a
 * throwaway repo before being trusted (this phase's own standing instruction): corrupting the
 * worktree's `.git` POINTER FILE itself, or its whole admin directory (e.g. via `chmod 000`),
 * instead makes git report `"not a git repository"` — an ORPHAN fragment that would misclassify
 * into the WRONG branch. `git worktree remove --force` on a corrupt-index worktree still succeeds
 * (force bypasses the dirty check entirely), so this fixture's own teardown needs no special
 * restoration afterward.
 */
function corruptWorktreeIndex(worktreePath) {
  const adminDir = worktreeAdminDir(worktreePath);
  writeFileSync(join(adminDir, "index"), randomBytes(64));
}

/**
 * `git worktree lock <worktreePath>` — unrelated to `git status` (a lock is pure admin metadata,
 * so the preflight still reports `clean`), but `worktreeRemove`'s single `--force` refuses a
 * LOCKED tree (`fatal: cannot remove a locked working tree; use 'remove -f -f' to override or
 * unlock first`), which is exactly the post-teardown `worktreeRemove` rejection branch 3 needs.
 * `cleanupWorkspace`'s own `fs.rm(workspacePath, ...)` runs UNCONDITIONALLY regardless of
 * `worktreeRemove`'s outcome, so the directory is still physically removed either way — locking
 * only makes the git-aware removal step itself fail, which is the branch's whole point. No explicit
 * unlock is needed afterward: {@link CLEANUP_BRANCH_SINGLE_FIXTURE} is a solo, disposable fixture
 * repo that {@link tearDownFixture} deletes wholesale (`rmSync` on `built.repoPath`) regardless of
 * any stale locked admin registration inside it.
 */
async function lockWorktree(repoPath, worktreePath) {
  await execFileP("git", ["worktree", "lock", worktreePath], { cwd: repoPath });
}

/**
 * Branch 1 of 5 (Task 1, `T-93-26`): `recordCleanupBlocked` — a dirty, non-forced worktree refuses
 * teardown before any destructive step. Single-session fixture: dirty the sole session's own
 * worktree, seed it past-due, drive the REAL scheduler (never a bespoke single-session entry
 * point), then read the persisted pointer.
 */
async function checkCleanupBranchBlocked(built) {
  const violations = [];
  const aWt = built.worktreePaths.a;
  dirtyWorktree(built, "a");
  const dirtyCount = await porcelainLineCount(aWt);
  console.log(
    `cleanup-branches: branch 1 (BLOCKED) PRECONDITION — porcelain lines=${dirtyCount} (expect >0)`,
  );
  if (dirtyCount === 0) {
    violations.push(
      `cleanup-branches: branch 1 PRECONDITION FAILED — worktree is not dirty`,
    );
    return violations;
  }

  const moveStatus = await moveCard(built, "done");
  if (moveStatus !== 204) {
    violations.push(
      `cleanup-branches: branch 1 — POST /move to done returned ${moveStatus}, expected 204`,
    );
    return violations;
  }
  await killAndWait(built.server?.child);
  const cardAtDone = readCard(built.dbPath, built.cardId);
  const aRecordAtDone = cardAtDone?.sessions?.find(
    (s) => s.id === built.sessionA.id,
  );
  if (!cardAtDone || cardAtDone.column !== "done" || !aRecordAtDone) {
    violations.push(
      `cleanup-branches: branch 1 — persisted card missing at Done arrival`,
    );
    return violations;
  }
  aRecordAtDone.cleanupDueAt = Date.now() - 5_000;
  seedFixtureCard(built.home, cardAtDone);

  const priorTickEnv = process.env.DISPATCH_CLEANUP_TICK_MS;
  process.env.DISPATCH_CLEANUP_TICK_MS = "500";
  try {
    built.server = bootServer(built.home);
    await waitForReady(built.port);
  } finally {
    if (priorTickEnv === undefined) delete process.env.DISPATCH_CLEANUP_TICK_MS;
    else process.env.DISPATCH_CLEANUP_TICK_MS = priorTickEnv;
  }

  const deadline = Date.now() + CLEANUP_ISOLATION_SETTLE_TIMEOUT_MS;
  let settledCard;
  let blocked = false;
  while (Date.now() < deadline) {
    settledCard = readCard(built.dbPath, built.cardId);
    const aRecord = settledCard?.sessions?.find(
      (s) => s.id === built.sessionA.id,
    );
    blocked = Boolean(aRecord?.cleanupBlocked?.length);
    if (blocked) break;
    await sleep(POLL_INTERVAL_MS);
  }
  console.log(
    `cleanup-branches: branch 1 (BLOCKED) — scheduler settle: refused=${blocked} within ${CLEANUP_ISOLATION_SETTLE_TIMEOUT_MS}ms`,
  );
  if (!blocked) {
    violations.push(
      `cleanup-branches: branch 1 — session was NOT refused by the real scheduler within ${CLEANUP_ISOLATION_SETTLE_TIMEOUT_MS}ms`,
    );
  }
  const aFinal = settledCard?.sessions?.find((s) => s.id === built.sessionA.id);
  const liveAfter = await tmuxListSessionNames();
  const tmuxAfter = liveAfter.includes(built.tmux.a);
  const listenAfter = await isPortListening(built.ttyd.a.port);
  console.log(
    `cleanup-branches: branch 1 (BLOCKED) — record present=${!!aFinal} tmux=${tmuxAfter} ttyd=${listenAfter} ` +
      `cleanupBlocked=${JSON.stringify(aFinal?.cleanupBlocked)}`,
  );
  if (!aFinal || !tmuxAfter || !listenAfter) {
    violations.push(
      `cleanup-branches: branch 1 — VIOLATED, a teardown step ran on a BLOCKED branch (record present=${!!aFinal} ` +
        `tmux=${tmuxAfter} ttyd=${listenAfter})`,
    );
  }
  assertPointerInvariant(settledCard, "branch 1 (BLOCKED)", violations);
  return violations;
}

/**
 * Branch 2 of 5 (Task 1, `T-93-26`): `noteCleanupWarning` — a non-orphan preflight error refuses
 * with zero teardown, distinct from branch 1's dirty refusal. Single-session fixture: corrupt the
 * worktree's OWN admin index so `worktreeStatus` classifies it `kind: "error"` (verified via a live
 * probe BEFORE trusting the scenario — "print which condition was actually produced" per this
 * plan's own interface note), seed past-due, drive the real scheduler.
 */
async function checkCleanupBranchPreflightError(built) {
  const violations = [];
  corruptWorktreeIndex(built.worktreePaths.a);
  const { worktreeStatus } = await loadGitAdapter();
  const probe = await worktreeStatus(built.worktreePaths.a);
  console.log(
    `cleanup-branches: branch 2 (PREFLIGHT ERROR) PRECONDITION — worktreeStatus probe kind=${probe.kind}` +
      (probe.kind === "error"
        ? ` stderr="${probe.stderr.trim().split("\n")[0]}"`
        : ""),
  );
  if (probe.kind !== "error") {
    violations.push(
      `cleanup-branches: branch 2 PRECONDITION FAILED — the corruption recipe classified as kind=${probe.kind}, ` +
        `expected the non-orphan "error" kind — this recipe does not reach the intended branch`,
    );
    return violations;
  }

  const moveStatus = await moveCard(built, "done");
  if (moveStatus !== 204) {
    violations.push(
      `cleanup-branches: branch 2 — POST /move to done returned ${moveStatus}, expected 204`,
    );
    return violations;
  }
  await killAndWait(built.server?.child);
  const cardAtDone = readCard(built.dbPath, built.cardId);
  const aRecordAtDone = cardAtDone?.sessions?.find(
    (s) => s.id === built.sessionA.id,
  );
  if (!cardAtDone || cardAtDone.column !== "done" || !aRecordAtDone) {
    violations.push(
      `cleanup-branches: branch 2 — persisted card missing at Done arrival`,
    );
    return violations;
  }
  aRecordAtDone.cleanupDueAt = Date.now() - 5_000;
  seedFixtureCard(built.home, cardAtDone);

  const priorTickEnv = process.env.DISPATCH_CLEANUP_TICK_MS;
  process.env.DISPATCH_CLEANUP_TICK_MS = "500";
  try {
    built.server = bootServer(built.home);
    await waitForReady(built.port);
  } finally {
    if (priorTickEnv === undefined) delete process.env.DISPATCH_CLEANUP_TICK_MS;
    else process.env.DISPATCH_CLEANUP_TICK_MS = priorTickEnv;
  }

  const expectedWarning =
    "Cleanup preflight failed — a worktree could not be checked.";
  const deadline = Date.now() + CLEANUP_ISOLATION_SETTLE_TIMEOUT_MS;
  let settledCard;
  let warned = false;
  while (Date.now() < deadline) {
    settledCard = readCard(built.dbPath, built.cardId);
    const aRecord = settledCard?.sessions?.find(
      (s) => s.id === built.sessionA.id,
    );
    warned = aRecord?.cleanupWarning === expectedWarning;
    if (warned) break;
    await sleep(POLL_INTERVAL_MS);
  }
  console.log(
    `cleanup-branches: branch 2 (PREFLIGHT ERROR) — scheduler settle: warned=${warned} within ${CLEANUP_ISOLATION_SETTLE_TIMEOUT_MS}ms`,
  );
  if (!warned) {
    violations.push(
      `cleanup-branches: branch 2 — session was NOT warned with the preflight-error message within ${CLEANUP_ISOLATION_SETTLE_TIMEOUT_MS}ms`,
    );
  }
  const aFinal = settledCard?.sessions?.find((s) => s.id === built.sessionA.id);
  const liveAfter = await tmuxListSessionNames();
  const tmuxAfter = liveAfter.includes(built.tmux.a);
  const listenAfter = await isPortListening(built.ttyd.a.port);
  console.log(
    `cleanup-branches: branch 2 (PREFLIGHT ERROR) — record present=${!!aFinal} tmux=${tmuxAfter} ttyd=${listenAfter} ` +
      `cleanupWarning=${JSON.stringify(aFinal?.cleanupWarning)} cleanupBlocked=${JSON.stringify(aFinal?.cleanupBlocked)}`,
  );
  if (!aFinal || !tmuxAfter || !listenAfter || aFinal?.cleanupBlocked?.length) {
    violations.push(
      `cleanup-branches: branch 2 — VIOLATED, a teardown step ran (or the wrong branch fired) on a PREFLIGHT-ERROR ` +
        `case (record present=${!!aFinal} tmux=${tmuxAfter} ttyd=${listenAfter} cleanupBlocked=${JSON.stringify(aFinal?.cleanupBlocked)})`,
    );
  }
  assertPointerInvariant(settledCard, "branch 2 (PREFLIGHT ERROR)", violations);
  return violations;
}

/**
 * Branch 3 of 5 (Task 1, `T-93-26`): `recordCleanupWarning` — a post-teardown `worktreeRemove`
 * rejection. Single-session fixture: leave the worktree CLEAN (so the preflight passes and reaches
 * the destructive step), lock it (so `worktreeRemove`'s single `--force` rejects), seed past-due,
 * drive the real scheduler. `killTtyd`/`killSession` run BEFORE the removal attempt (NEW-14), so
 * this branch's session/tmux/ttyd are cleared regardless of the removal outcome — the record
 * SURVIVES (recordCleanupWarning is non-removing) carrying the warning.
 */
async function checkCleanupBranchPostTeardownFailure(built) {
  const violations = [];
  const aWt = built.worktreePaths.a;
  const cleanCount = await porcelainLineCount(aWt);
  console.log(
    `cleanup-branches: branch 3 (POST-TEARDOWN FAILURE) PRECONDITION — porcelain lines=${cleanCount} (expect 0, ` +
      `so the preflight passes and reaches worktreeRemove)`,
  );
  if (cleanCount !== 0) {
    violations.push(
      `cleanup-branches: branch 3 PRECONDITION FAILED — worktree is not clean`,
    );
    return violations;
  }
  await lockWorktree(built.repoPath, aWt);
  console.log(
    `cleanup-branches: branch 3 — locked the worktree (\`git worktree remove --force\` refuses a locked ` +
      `tree; \`git status\` is unaffected by a lock, so the preflight still passes)`,
  );

  const moveStatus = await moveCard(built, "done");
  if (moveStatus !== 204) {
    violations.push(
      `cleanup-branches: branch 3 — POST /move to done returned ${moveStatus}, expected 204`,
    );
    return violations;
  }
  await killAndWait(built.server?.child);
  const cardAtDone = readCard(built.dbPath, built.cardId);
  const aRecordAtDone = cardAtDone?.sessions?.find(
    (s) => s.id === built.sessionA.id,
  );
  if (!cardAtDone || cardAtDone.column !== "done" || !aRecordAtDone) {
    violations.push(
      `cleanup-branches: branch 3 — persisted card missing at Done arrival`,
    );
    return violations;
  }
  aRecordAtDone.cleanupDueAt = Date.now() - 5_000;
  seedFixtureCard(built.home, cardAtDone);

  const priorTickEnv = process.env.DISPATCH_CLEANUP_TICK_MS;
  process.env.DISPATCH_CLEANUP_TICK_MS = "500";
  try {
    built.server = bootServer(built.home);
    await waitForReady(built.port);
  } finally {
    if (priorTickEnv === undefined) delete process.env.DISPATCH_CLEANUP_TICK_MS;
    else process.env.DISPATCH_CLEANUP_TICK_MS = priorTickEnv;
  }

  const expectedWarning = "Cleanup incomplete — some worktrees may remain.";
  const deadline = Date.now() + CLEANUP_ISOLATION_SETTLE_TIMEOUT_MS;
  let settledCard;
  let warned = false;
  while (Date.now() < deadline) {
    settledCard = readCard(built.dbPath, built.cardId);
    const aRecord = settledCard?.sessions?.find(
      (s) => s.id === built.sessionA.id,
    );
    warned = aRecord?.cleanupWarning === expectedWarning;
    if (warned) break;
    await sleep(POLL_INTERVAL_MS);
  }
  console.log(
    `cleanup-branches: branch 3 (POST-TEARDOWN FAILURE) — scheduler settle: warned=${warned} within ${CLEANUP_ISOLATION_SETTLE_TIMEOUT_MS}ms`,
  );
  if (!warned) {
    violations.push(
      `cleanup-branches: branch 3 — session was NOT warned with the post-teardown-failure message within ${CLEANUP_ISOLATION_SETTLE_TIMEOUT_MS}ms`,
    );
  }
  const aFinal = settledCard?.sessions?.find((s) => s.id === built.sessionA.id);
  const liveAfter = await tmuxListSessionNames();
  const tmuxAfter = liveAfter.includes(built.tmux.a);
  const listenAfter = await isPortListening(built.ttyd.a.port);
  console.log(
    `cleanup-branches: branch 3 (POST-TEARDOWN FAILURE) — record present=${!!aFinal} tmux=${tmuxAfter} ` +
      `ttyd=${listenAfter} cleanupWarning=${JSON.stringify(aFinal?.cleanupWarning)}`,
  );
  if (!aFinal || tmuxAfter || listenAfter) {
    violations.push(
      `cleanup-branches: branch 3 — VIOLATED, expected the record to survive with tmux/ttyd CLEARED ` +
        `(record present=${!!aFinal} tmux=${tmuxAfter} ttyd=${listenAfter})`,
    );
  }
  assertPointerInvariant(
    settledCard,
    "branch 3 (POST-TEARDOWN FAILURE)",
    violations,
  );
  return violations;
}

/**
 * Branch 4 of 5 (Task 1, `T-93-26`): `recordCleanupWarning` — the LEGACY-WORKSPACE site, sharing
 * `recordCleanupWarning` with branch 3 but reached under a DIFFERENT precondition
 * (`isLegacyWorkspace`, never a removal failure). Single-session fixture: after Done arrival, strip
 * `workspace` from the session record (and the card's own mirror, to keep the fixture's OWN
 * precondition internally consistent with the pointer invariant this check itself asserts) while
 * leaving `workspacePath` set to the real per-session folder — reproducing a card that predates
 * per-ticket git workspaces. `repoPaths` resolves empty, so the preflight probes nothing and the
 * teardown proceeds straight to killing tmux/ttyd and `fs.rm`-ing the workspace folder.
 */
async function checkCleanupBranchLegacyWorkspace(built) {
  const violations = [];
  const moveStatus = await moveCard(built, "done");
  if (moveStatus !== 204) {
    violations.push(
      `cleanup-branches: branch 4 — POST /move to done returned ${moveStatus}, expected 204`,
    );
    return violations;
  }
  await killAndWait(built.server?.child);
  const cardAtDone = readCard(built.dbPath, built.cardId);
  const aRecordAtDone = cardAtDone?.sessions?.find(
    (s) => s.id === built.sessionA.id,
  );
  if (!cardAtDone || cardAtDone.column !== "done" || !aRecordAtDone) {
    violations.push(
      `cleanup-branches: branch 4 — persisted card missing at Done arrival`,
    );
    return violations;
  }
  const workspacePathBefore = aRecordAtDone.workspacePath;
  console.log(
    `cleanup-branches: branch 4 (LEGACY WORKSPACE) — stripping session.workspace (and the card's own ` +
      `mirror) to reproduce a pre-per-ticket-workspace card; workspacePath ${workspacePathBefore} stays set`,
  );
  delete aRecordAtDone.workspace;
  delete cardAtDone.workspace;
  aRecordAtDone.cleanupDueAt = Date.now() - 5_000;
  cardAtDone.cleanupDueAt = aRecordAtDone.cleanupDueAt;
  seedFixtureCard(built.home, cardAtDone);

  const priorTickEnv = process.env.DISPATCH_CLEANUP_TICK_MS;
  process.env.DISPATCH_CLEANUP_TICK_MS = "500";
  try {
    built.server = bootServer(built.home);
    await waitForReady(built.port);
  } finally {
    if (priorTickEnv === undefined) delete process.env.DISPATCH_CLEANUP_TICK_MS;
    else process.env.DISPATCH_CLEANUP_TICK_MS = priorTickEnv;
  }

  const expectedWarning =
    "Cleanup kept worktree registrations — this ticket predates per-ticket workspaces.";
  const deadline = Date.now() + CLEANUP_ISOLATION_SETTLE_TIMEOUT_MS;
  let settledCard;
  let warned = false;
  while (Date.now() < deadline) {
    settledCard = readCard(built.dbPath, built.cardId);
    const aRecord = settledCard?.sessions?.find(
      (s) => s.id === built.sessionA.id,
    );
    warned = aRecord?.cleanupWarning === expectedWarning;
    if (warned) break;
    await sleep(POLL_INTERVAL_MS);
  }
  console.log(
    `cleanup-branches: branch 4 (LEGACY WORKSPACE) — scheduler settle: warned=${warned} within ${CLEANUP_ISOLATION_SETTLE_TIMEOUT_MS}ms`,
  );
  if (!warned) {
    violations.push(
      `cleanup-branches: branch 4 — session was NOT warned with the legacy-workspace message within ${CLEANUP_ISOLATION_SETTLE_TIMEOUT_MS}ms`,
    );
  }
  const aFinal = settledCard?.sessions?.find((s) => s.id === built.sessionA.id);
  const liveAfter = await tmuxListSessionNames();
  const tmuxAfter = liveAfter.includes(built.tmux.a);
  const listenAfter = await isPortListening(built.ttyd.a.port);
  const dirGone = !existsSync(workspacePathBefore);
  console.log(
    `cleanup-branches: branch 4 (LEGACY WORKSPACE) — record present=${!!aFinal} tmux=${tmuxAfter} ` +
      `ttyd=${listenAfter} workspaceDirGone=${dirGone} cleanupWarning=${JSON.stringify(aFinal?.cleanupWarning)}`,
  );
  if (!aFinal || tmuxAfter || listenAfter || !dirGone) {
    violations.push(
      `cleanup-branches: branch 4 — VIOLATED, expected the record to survive with tmux/ttyd cleared and ` +
        `the workspace folder removed (record present=${!!aFinal} tmux=${tmuxAfter} ttyd=${listenAfter} dirGone=${dirGone})`,
    );
  }
  assertPointerInvariant(
    settledCard,
    "branch 4 (LEGACY WORKSPACE)",
    violations,
  );
  return violations;
}

/**
 * Branch 5 of 5, ACTIVE-WITH-SIBLING promotion case (Task 1, `T-93-26`): cleaning the card's
 * ACTIVE session on a two-session card promotes the remaining sibling in the SAME mutation. Session
 * A is `standUpFixture`'s always-first, always-active key; session B is the untouched sibling.
 * Seeds ONLY A past-due and drives the real scheduler, polling BOTH the direct store read and the
 * live wire throughout the teardown — the wire's raw `activeSessionId` (never redacted) alongside
 * its DERIVED `activeSession` lets a dangling pointer be caught the instant it would first become
 * externally observable, not just at the final settled read.
 */
async function checkCleanupBranchPromotionActiveWithSibling(built) {
  const violations = [];
  const moveStatus = await moveCard(built, "done");
  if (moveStatus !== 204) {
    violations.push(
      `cleanup-branches: branch 5a — POST /move to done returned ${moveStatus}, expected 204`,
    );
    return violations;
  }
  await killAndWait(built.server?.child);
  const cardAtDone = readCard(built.dbPath, built.cardId);
  const aRecordAtDone = cardAtDone?.sessions?.find(
    (s) => s.id === built.sessionA.id,
  );
  const bRecordAtDone = cardAtDone?.sessions?.find(
    (s) => s.id === built.sessionB.id,
  );
  if (
    !cardAtDone ||
    cardAtDone.column !== "done" ||
    !aRecordAtDone ||
    !bRecordAtDone
  ) {
    violations.push(
      `cleanup-branches: branch 5a — persisted card missing a session at Done arrival`,
    );
    return violations;
  }
  const bCreatedAt = bRecordAtDone.createdAt;
  aRecordAtDone.cleanupDueAt = Date.now() - 5_000;
  seedFixtureCard(built.home, cardAtDone);
  console.log(
    `cleanup-branches: branch 5a (ACTIVE-WITH-SIBLING) — seeded ONLY A's (active) cleanupDueAt past-due; ` +
      `B is left untouched, never due`,
  );

  const priorTickEnv = process.env.DISPATCH_CLEANUP_TICK_MS;
  process.env.DISPATCH_CLEANUP_TICK_MS = "500";
  try {
    built.server = bootServer(built.home);
    await waitForReady(built.port);
  } finally {
    if (priorTickEnv === undefined) delete process.env.DISPATCH_CLEANUP_TICK_MS;
    else process.env.DISPATCH_CLEANUP_TICK_MS = priorTickEnv;
  }

  const deadline = Date.now() + CLEANUP_ISOLATION_SETTLE_TIMEOUT_MS;
  let settledCard;
  let aGone = false;
  let wireObservations = 0;
  let observedDanglingWire = false;
  while (Date.now() < deadline) {
    settledCard = readCard(built.dbPath, built.cardId);
    aGone =
      settledCard != null &&
      !(settledCard.sessions ?? []).some((s) => s.id === built.sessionA.id);
    const wireCard = await fetchFixtureCard(built);
    if (wireCard) {
      wireObservations++;
      if (
        wireCard.activeSessionId != null &&
        wireCard.activeSession === undefined
      ) {
        observedDanglingWire = true;
        console.log(
          `cleanup-branches: branch 5a — WIRE OBSERVED a dangling pointer: activeSessionId=` +
            `${wireCard.activeSessionId} but activeSession is undefined`,
        );
      }
    }
    if (aGone) break;
    await sleep(POLL_INTERVAL_MS);
  }
  console.log(
    `cleanup-branches: branch 5a (ACTIVE-WITH-SIBLING) — scheduler settle: A gone=${aGone} within ` +
      `${CLEANUP_ISOLATION_SETTLE_TIMEOUT_MS}ms; wire observations=${wireObservations}, any dangling=${observedDanglingWire}`,
  );
  if (!aGone) {
    violations.push(
      `cleanup-branches: branch 5a — session A was not torn down by the real scheduler within ${CLEANUP_ISOLATION_SETTLE_TIMEOUT_MS}ms`,
    );
    return violations;
  }
  if (observedDanglingWire) {
    violations.push(
      `cleanup-branches: branch 5a — POINTER VIOLATED, the wire showed activeSessionId set with no ` +
        `resolving activeSession at least once during the teardown`,
    );
  }

  const bFinal = settledCard?.sessions?.find((s) => s.id === built.sessionB.id);
  const liveAfter = await tmuxListSessionNames();
  const bTmuxAfter = liveAfter.includes(built.tmux.b);
  const bListenAfter = await isPortListening(built.ttyd.b.port);
  console.log(
    `cleanup-branches: branch 5a — STORE sessions=${JSON.stringify((settledCard?.sessions ?? []).map((s) => s.id))} ` +
      `activeSessionId=${settledCard?.activeSessionId} B present=${!!bFinal} B tmux=${bTmuxAfter} B ttyd=${bListenAfter} ` +
      `B createdAt unchanged=${bFinal?.createdAt === bCreatedAt}`,
  );
  if (!bFinal || !bTmuxAfter || !bListenAfter) {
    violations.push(
      `cleanup-branches: branch 5a — VIOLATED, B (the sibling) was disturbed by cleaning A (present=${!!bFinal} ` +
        `tmux=${bTmuxAfter} ttyd=${bListenAfter})`,
    );
  }
  if (bFinal && bFinal.createdAt !== bCreatedAt) {
    violations.push(
      `cleanup-branches: branch 5a — PROMOTION VIOLATED, B's record was RE-MINTED (createdAt changed from ` +
        `${bCreatedAt} to ${bFinal.createdAt}) rather than the original record being promoted`,
    );
  }
  if (settledCard?.activeSessionId !== built.sessionB.id) {
    violations.push(
      `cleanup-branches: branch 5a — PROMOTION VIOLATED, activeSessionId expected ${built.sessionB.id} ` +
        `(B, the only remaining sibling), actual ${settledCard?.activeSessionId}`,
    );
  }
  assertPointerInvariant(
    settledCard,
    "branch 5a (ACTIVE-WITH-SIBLING)",
    violations,
  );
  return violations;
}

/**
 * Branch 5 of 5, LAST-SESSION promotion case (Task 1, `T-93-26`): cleaning the card's ONLY session
 * leaves it genuinely sessionless — `sessions` empty, `activeSessionId` absent (cleared, never
 * dangling), the flat six-field mirror fully cleared. Single-session fixture.
 */
async function checkCleanupBranchPromotionLastSession(built) {
  const violations = [];
  const moveStatus = await moveCard(built, "done");
  if (moveStatus !== 204) {
    violations.push(
      `cleanup-branches: branch 5b — POST /move to done returned ${moveStatus}, expected 204`,
    );
    return violations;
  }
  await killAndWait(built.server?.child);
  const cardAtDone = readCard(built.dbPath, built.cardId);
  const aRecordAtDone = cardAtDone?.sessions?.find(
    (s) => s.id === built.sessionA.id,
  );
  if (!cardAtDone || cardAtDone.column !== "done" || !aRecordAtDone) {
    violations.push(
      `cleanup-branches: branch 5b — persisted card missing at Done arrival`,
    );
    return violations;
  }
  aRecordAtDone.cleanupDueAt = Date.now() - 5_000;
  seedFixtureCard(built.home, cardAtDone);
  console.log(
    `cleanup-branches: branch 5b (LAST-SESSION) — seeded the card's ONLY session's cleanupDueAt past-due`,
  );

  const priorTickEnv = process.env.DISPATCH_CLEANUP_TICK_MS;
  process.env.DISPATCH_CLEANUP_TICK_MS = "500";
  try {
    built.server = bootServer(built.home);
    await waitForReady(built.port);
  } finally {
    if (priorTickEnv === undefined) delete process.env.DISPATCH_CLEANUP_TICK_MS;
    else process.env.DISPATCH_CLEANUP_TICK_MS = priorTickEnv;
  }

  const deadline = Date.now() + CLEANUP_ISOLATION_SETTLE_TIMEOUT_MS;
  let settledCard;
  let empty = false;
  while (Date.now() < deadline) {
    settledCard = readCard(built.dbPath, built.cardId);
    empty = settledCard != null && (settledCard.sessions ?? []).length === 0;
    if (empty) break;
    await sleep(POLL_INTERVAL_MS);
  }
  console.log(
    `cleanup-branches: branch 5b (LAST-SESSION) — scheduler settle: sessions empty=${empty} within ` +
      `${CLEANUP_ISOLATION_SETTLE_TIMEOUT_MS}ms`,
  );
  if (!empty) {
    violations.push(
      `cleanup-branches: branch 5b — the card's only session was not fully removed within ${CLEANUP_ISOLATION_SETTLE_TIMEOUT_MS}ms`,
    );
    return violations;
  }
  console.log(
    `cleanup-branches: branch 5b — STORE sessions=${JSON.stringify(settledCard.sessions)} ` +
      `activeSessionId=${settledCard.activeSessionId} tmuxSession=${settledCard.tmuxSession} ` +
      `workspacePath=${settledCard.workspacePath}`,
  );
  const flatFields = [
    "tmuxSession",
    "ttydPort",
    "hookToken",
    "claudeSessionId",
    "workspacePath",
    "workspace",
  ];
  for (const field of flatFields) {
    if (settledCard[field] != null) {
      violations.push(
        `cleanup-branches: branch 5b — VIOLATED, card.${field} is still set (${JSON.stringify(settledCard[field])}) ` +
          `after the card became sessionless`,
      );
    }
  }
  assertPointerInvariant(settledCard, "branch 5b (LAST-SESSION)", violations);
  return violations;
}

/**
 * The scheduler's own LEFT-DONE ABANDON leg (Task 2): a card that left Done must never be torn
 * down by a later tick, even adversarially. First exercises the REAL `moveCardManual` Done-arrival
 * then Done-departure path (asserting its own clearing of `cleanupDueAt` as a live precondition —
 * this alone already discriminates against the plan's literally-prescribed break, see the
 * SUMMARY's Key Decisions), THEN re-stamps a stale past-due `cleanupDueAt` directly, bypassing the
 * clear, to prove the SCHEDULER'S OWN `card.column !== "done"` guards (both
 * `sessionsDueForCleanup`'s snapshot filter and `runDueCleanups`'s fresh re-check) refuse a
 * non-Done card independently of whether the clear ran.
 */
async function checkSchedulerLeftDoneAbandon(built) {
  const violations = [];
  const aWt = built.worktreePaths.a;

  let moveStatus = await moveCard(built, "done");
  if (moveStatus !== 204) {
    violations.push(
      `cleanup-branches: LEFT-DONE — POST /move to done returned ${moveStatus}, expected 204`,
    );
    return violations;
  }
  moveStatus = await moveCard(built, "in_progress");
  console.log(
    `cleanup-branches: LEFT-DONE — POST /move done->in_progress -> ${moveStatus} (expected 204)`,
  );
  if (moveStatus !== 204) {
    violations.push(
      `cleanup-branches: LEFT-DONE — POST /move done->in_progress returned ${moveStatus}, expected 204`,
    );
    return violations;
  }
  await killAndWait(built.server?.child);
  const cardAtLeft = readCard(built.dbPath, built.cardId);
  const aRecordAtLeft = cardAtLeft?.sessions?.find(
    (s) => s.id === built.sessionA.id,
  );
  if (!cardAtLeft || cardAtLeft.column !== "in_progress" || !aRecordAtLeft) {
    violations.push(
      `cleanup-branches: LEFT-DONE — persisted card is not in the expected post-departure shape`,
    );
    return violations;
  }
  console.log(
    `cleanup-branches: LEFT-DONE — real moveCardManual's own clearing left cleanupDueAt=` +
      `${aRecordAtLeft.cleanupDueAt} after the done->in_progress move (expect undefined)`,
  );
  if (aRecordAtLeft.cleanupDueAt !== undefined) {
    violations.push(
      `cleanup-branches: LEFT-DONE VIOLATED — moveCardManual did not clear cleanupDueAt on leaving Done ` +
        `(still ${aRecordAtLeft.cleanupDueAt})`,
    );
  }

  aRecordAtLeft.cleanupDueAt = Date.now() - 5_000;
  seedFixtureCard(built.home, cardAtLeft);
  console.log(
    `cleanup-branches: LEFT-DONE — adversarially re-stamped a stale past-due cleanupDueAt directly, ` +
      `bypassing the clear, to prove the scheduler's OWN column guards refuse a non-Done card independently`,
  );

  const priorTickEnv = process.env.DISPATCH_CLEANUP_TICK_MS;
  process.env.DISPATCH_CLEANUP_TICK_MS = "500";
  try {
    built.server = bootServer(built.home);
    await waitForReady(built.port);
  } finally {
    if (priorTickEnv === undefined) delete process.env.DISPATCH_CLEANUP_TICK_MS;
    else process.env.DISPATCH_CLEANUP_TICK_MS = priorTickEnv;
  }
  await sleep(3_000);

  const settledCard = readCard(built.dbPath, built.cardId);
  const aFinal = settledCard?.sessions?.find((s) => s.id === built.sessionA.id);
  const liveAfter = await tmuxListSessionNames();
  const tmuxAfter = liveAfter.includes(built.tmux.a);
  const listenAfter = await isPortListening(built.ttyd.a.port);
  const dirAfter = existsSync(aWt);
  console.log(
    `cleanup-branches: LEFT-DONE — after ~3s (~6 ticks) of a non-Done card carrying a stale past-due ` +
      `cleanupDueAt: record present=${!!aFinal} tmux=${tmuxAfter} ttyd=${listenAfter} worktreeDir=${dirAfter} ` +
      `cleanupAttempt=${aFinal?.cleanupAttempt ?? 0}`,
  );
  if (
    !aFinal ||
    !tmuxAfter ||
    !listenAfter ||
    !dirAfter ||
    (aFinal?.cleanupAttempt ?? 0) !== 0
  ) {
    violations.push(
      `cleanup-branches: LEFT-DONE VIOLATED — a card that left Done was torn down by a later tick ` +
        `(record present=${!!aFinal} tmux=${tmuxAfter} ttyd=${listenAfter} worktreeDir=${dirAfter} ` +
        `cleanupAttempt=${aFinal?.cleanupAttempt ?? 0})`,
    );
  }
  return violations;
}

/**
 * The manual route's DOUBLE-DISPATCH guard (Task 2, `WR-01`): two `POST /cards/:id/cleanup`
 * requests fired back-to-back must settle into exactly one 202 and one 409, and exactly ONE
 * teardown must actually run. `card.cleanupAttempt` is bumped exactly once by every terminal
 * cleanup branch (the one deliberately UNGATED mirror field), so its before/after DELTA is a
 * precise, already-persisted signal for "how many teardown attempts landed" — a second concurrent
 * dispatch that slipped past the guard would bump it twice. The scheduler's own `isCleaningUp`
 * `continue` branch shares this SAME card-scoped guard (not a second one), so it is covered through
 * this same assertion rather than a separately forced tick collision.
 */
async function checkSchedulerDoubleDispatchGuard(built) {
  const violations = [];
  const moveStatus = await moveCard(built, "done");
  if (moveStatus !== 204) {
    violations.push(
      `cleanup-branches: DOUBLE-DISPATCH — POST /move to done returned ${moveStatus}, expected 204`,
    );
    return violations;
  }
  const cardBefore = readCard(built.dbPath, built.cardId);
  const attemptsBefore = cardBefore?.cleanupAttempt ?? 0;
  console.log(
    `cleanup-branches: DOUBLE-DISPATCH GUARD — card.cleanupAttempt before=${attemptsBefore}`,
  );

  const [status1, status2] = await Promise.all([
    postCleanup(built, { force: false }),
    postCleanup(built, { force: false }),
  ]);
  console.log(
    `cleanup-branches: DOUBLE-DISPATCH GUARD — two concurrent POST /cleanup -> [${status1}, ${status2}]`,
  );
  const statuses = [status1, status2].sort((a, b) => a - b);
  if (statuses[0] !== 202 || statuses[1] !== 409) {
    violations.push(
      `cleanup-branches: DOUBLE-DISPATCH VIOLATED — expected exactly one 202 and one 409, got [${status1}, ${status2}]`,
    );
  }

  const deadline = Date.now() + CLEANUP_ISOLATION_SETTLE_TIMEOUT_MS;
  let settledCard;
  let gone = false;
  while (Date.now() < deadline) {
    settledCard = readCard(built.dbPath, built.cardId);
    gone =
      settledCard != null &&
      !(settledCard.sessions ?? []).some((s) => s.id === built.sessionA.id);
    if (gone) break;
    await sleep(POLL_INTERVAL_MS);
  }
  console.log(
    `cleanup-branches: DOUBLE-DISPATCH GUARD — settle: session gone=${gone}`,
  );
  if (!gone) {
    violations.push(
      `cleanup-branches: DOUBLE-DISPATCH — the single dispatch did not settle within ${CLEANUP_ISOLATION_SETTLE_TIMEOUT_MS}ms`,
    );
    return violations;
  }
  const attemptsAfter = settledCard?.cleanupAttempt ?? 0;
  const delta = attemptsAfter - attemptsBefore;
  console.log(
    `cleanup-branches: DOUBLE-DISPATCH GUARD — card.cleanupAttempt after=${attemptsAfter} (delta=${delta}, ` +
      `expect exactly 1 — a second concurrent teardown would bump it twice)`,
  );
  if (delta !== 1) {
    violations.push(
      `cleanup-branches: DOUBLE-DISPATCH VIOLATED — expected exactly ONE teardown (cleanupAttempt delta=1), ` +
        `got delta=${delta} — a second dispatch was not fully blocked`,
    );
  }
  return violations;
}

/**
 * Any tmux session matching the REAL product naming convention (`"dsp-" + card.identifier`,
 * `start-session.ts`/`resume-session.ts`) — distinct from every harness fixture prefix, which all
 * carry extra characters before their own `-` (`dsp91h-`, `dsp93h-`, ...). A non-empty result here
 * would mean a real start/resume saga actually spawned a session somewhere during this run.
 */
async function scanForRealProductSessions() {
  const names = await tmuxListSessionNames();
  return names.filter((n) => /^dsp-/.test(n));
}

/**
 * The `isStarting` -> `restoreCleanupDue` leg (Task 2, `T-93-26`): NOT DRIVABLE by this harness,
 * recorded honestly rather than faked — see the SUMMARY's own section for the full reasoning. In
 * short: `isStarting` only stays `true` across a real `await` gap (long enough for an independent
 * async scheduler tick to observe it) on a start/resume saga path, and BOTH sagas
 * (`start-session.ts`, `resume-session.ts`) unconditionally reach `newSession(...)` — a real
 * `claude` spawn — once past their synchronous early-return guards, with no legitimate awaited
 * failure point in between (`preSeedTrust` swallows its own errors into `false`, never throws;
 * `resolveBinaryPath` falls back to the literal `"claude"` on a miss rather than throwing). The
 * ONLY early-return path that avoids the spawn runs with ZERO `await` before it, so its
 * `isStarting` window is a single synchronous JS frame — unobservable to any request-driven
 * external process. Firing a live request far enough to test this honestly therefore risks
 * spawning `claude`, which this harness must never do (non-negotiable safety rule 5), so the branch
 * is left undriven rather than risked.
 */
function checkSchedulerIsStartingNotDrivable() {
  const reason =
    "cleanup-branches: isStarting -> restoreCleanupDue — NOT DRIVABLE. Both start-session.ts and " +
    "resume-session.ts hold isStarting=true across a real await gap only on paths that " +
    "unconditionally reach newSession(...) (a real `claude` spawn) before any awaited call that " +
    "could legitimately fail first; their only pre-spawn early-return checks run with zero awaits, " +
    "making the isStarting window a single synchronous JS frame no external async scheduler tick " +
    "could ever observe. Reaching this branch live would risk violating the never-spawn-claude " +
    "safety rule, so it was not attempted — recorded narrower-than-literal coverage per " +
    "92-VERDICT.md's precedent rather than substituting a store-record read as proof.";
  console.log(reason);
  return { violations: [], note: reason };
}

/**
 * `--check cleanup-branches` (Phase 93 criterion 4, `T-93-26`..`T-93-30`): the ENUMERATION
 * assertion, all five terminal branches (four single-session fixture cycles plus the two promotion
 * cases), the scheduler's own three pre-dispatch legs, and a zero-real-product-session scan
 * bracketing the whole run — the honest backstop for the one leg (isStarting) this harness does not
 * drive live.
 */
async function checkCleanupBranches() {
  const violations = [];
  violations.push(...enumerateCleanupBranchesFromSource());

  const realSessionsBefore = await scanForRealProductSessions();
  console.log(
    `cleanup-branches: pre-run zero-real-product-session scan — any "dsp-*" tmux session BEFORE this check=` +
      `${JSON.stringify(realSessionsBefore)}`,
  );

  violations.push(
    ...(await withFixture(
      "cleanup-branches-blocked",
      checkCleanupBranchBlocked,
      CLEANUP_BRANCH_SINGLE_FIXTURE,
    )),
  );
  violations.push(
    ...(await withFixture(
      "cleanup-branches-preflight-error",
      checkCleanupBranchPreflightError,
      CLEANUP_BRANCH_SINGLE_FIXTURE,
    )),
  );
  violations.push(
    ...(await withFixture(
      "cleanup-branches-post-teardown-failure",
      checkCleanupBranchPostTeardownFailure,
      CLEANUP_BRANCH_SINGLE_FIXTURE,
    )),
  );
  violations.push(
    ...(await withFixture(
      "cleanup-branches-legacy-workspace",
      checkCleanupBranchLegacyWorkspace,
      CLEANUP_BRANCH_SINGLE_FIXTURE,
    )),
  );
  violations.push(
    ...(await withFixture(
      "cleanup-branches-promotion-active-sibling",
      checkCleanupBranchPromotionActiveWithSibling,
      WORKTREE_FIXTURE,
    )),
  );
  violations.push(
    ...(await withFixture(
      "cleanup-branches-promotion-last-session",
      checkCleanupBranchPromotionLastSession,
      CLEANUP_BRANCH_SINGLE_FIXTURE,
    )),
  );
  violations.push(
    ...(await withFixture(
      "cleanup-branches-scheduler-left-done",
      checkSchedulerLeftDoneAbandon,
      CLEANUP_BRANCH_SINGLE_FIXTURE,
    )),
  );
  violations.push(
    ...(await withFixture(
      "cleanup-branches-scheduler-double-dispatch",
      checkSchedulerDoubleDispatchGuard,
      CLEANUP_BRANCH_SINGLE_FIXTURE,
    )),
  );

  const { violations: isStartingViolations } =
    checkSchedulerIsStartingNotDrivable();
  violations.push(...isStartingViolations);

  const realSessionsAfter = await scanForRealProductSessions();
  console.log(
    `cleanup-branches: post-run zero-real-product-session scan — any "dsp-*" tmux session AFTER this check=` +
      `${JSON.stringify(realSessionsAfter)}`,
  );
  if (realSessionsBefore.length > 0 || realSessionsAfter.length > 0) {
    violations.push(
      `cleanup-branches: SAFETY VIOLATED — a real product-named tmux session was observed (before=` +
        `${JSON.stringify(realSessionsBefore)} after=${JSON.stringify(realSessionsAfter)}) — a start/resume ` +
        `saga must never actually run inside this harness`,
    );
  }

  return violations;
}

/**
 * Timing budget for {@link checkCleanupScheduleRestartFalsifiability} (Phase 93 criterion 2, the
 * FIRST entry in 93-VALIDATION.md's own Dead-Instrument Register). `EARLY_DUE_MS` must be generous
 * enough that seeding, the first boot ("the schedule"), and the restart that happens BEFORE the due
 * time all still complete before it elapses — the restart is the whole point of this check, not a
 * rounding error to race against. `LATE_DUE_MS` must be far enough beyond the entire observation
 * window (seed -> boot -> restart -> settle-poll for A) that a correct per-session scheduler
 * genuinely cannot reach it — this check asserts the observed elapsed time is still shorter than
 * `LATE_DUE_MS`, so "B was untouched" is never an artifact of the check finishing early.
 * `DUE_TIME_MIN_SEPARATION_MS` is the permanent guard against the register's own named hazard: a
 * fixture that seeds the two due times equal — or merely close together — cannot distinguish real
 * per-session scheduling from the old per-card scheduler that happens to see one session, so the
 * check refuses outright rather than silently passing on a non-discriminating fixture.
 */
const EARLY_DUE_MS = 15_000;
const LATE_DUE_MS = 300_000;
const DUE_TIME_MIN_SEPARATION_MS = 60_000;

/**
 * Settle margin {@link checkCleanupScheduleRestartFalsifiability} adds on top of a due timestamp
 * before giving up on the real scheduler having dispatched it — generous relative to the 500ms tick
 * this check runs the sandbox server with, and relative to the throwaway repo's own sub-second git
 * subprocess latency (matches {@link CLEANUP_ISOLATION_SETTLE_TIMEOUT_MS}'s own reasoning).
 */
const SCHEDULE_RESTART_SETTLE_MARGIN_MS = 20_000;

/**
 * `--check cleanup-schedule-restart` PART A (the product path, Phase 93 criterion 2): a genuine
 * Done arrival, through the real `/api/cards/:id/move` route, must stamp `cleanupDueAt` on EVERY
 * eligible session the ticket owns — never only the active one — and the card's own flat
 * `cleanupDueAt` mirror must equal the active session's own stamp. This is required alongside PART
 * B's falsifiability path (93-VALIDATION.md's Interfaces note): PART B seeds two DIFFERENT due
 * times directly, which is what makes the per-session claim falsifiable, but only PART A proves a
 * REAL Done arrival is what produces per-session schedules in the first place.
 */
async function checkCleanupScheduleRestartProductPath(built) {
  const violations = [];
  const moveStatus = await moveCard(built, "done");
  console.log(
    `cleanup-schedule-restart: PART A — POST /move to done -> ${moveStatus} (expected 204)`,
  );
  if (moveStatus !== 204) {
    violations.push(
      `cleanup-schedule-restart: PART A VIOLATED — POST /move to done returned ${moveStatus}, expected 204`,
    );
    return violations;
  }
  const card = readCard(built.dbPath, built.cardId);
  const aRecord = card?.sessions?.find((s) => s.id === built.sessionA.id);
  const bRecord = card?.sessions?.find((s) => s.id === built.sessionB.id);
  const activeRecord = card?.sessions?.find(
    (s) => s.id === card.activeSessionId,
  );
  console.log(
    `cleanup-schedule-restart: PART A — A.cleanupDueAt=${aRecord?.cleanupDueAt} ` +
      `B.cleanupDueAt=${bRecord?.cleanupDueAt} card.cleanupDueAt=${card?.cleanupDueAt} ` +
      `card.activeSessionId=${card?.activeSessionId}`,
  );
  if (aRecord?.cleanupDueAt == null) {
    violations.push(
      `cleanup-schedule-restart: PART A VIOLATED — session A carries no cleanupDueAt after a real Done arrival`,
    );
  }
  if (bRecord?.cleanupDueAt == null) {
    violations.push(
      `cleanup-schedule-restart: PART A VIOLATED — session B carries no cleanupDueAt after a real Done ` +
        `arrival — a Done arrival that schedules only the active session would pass this check without B stamped`,
    );
  }
  if (card?.cleanupDueAt !== activeRecord?.cleanupDueAt) {
    violations.push(
      `cleanup-schedule-restart: PART A VIOLATED — card.cleanupDueAt (${card?.cleanupDueAt}) does not mirror ` +
        `the active session's own cleanupDueAt (${activeRecord?.cleanupDueAt})`,
    );
  }
  return violations;
}

/**
 * `--check cleanup-schedule-restart` PART B (the falsifiability path, Phase 93 criterion 2): seeds
 * session A and session B with two DIFFERENT due times directly into the sandbox `board.db`, with
 * the card already `column: "done"` — never through a real Done arrival, which (PART A) stamps both
 * at the SAME instant and therefore cannot discriminate a per-session scheduler from the old
 * per-card one. Boots the sandbox server (the SCHEDULE), then RESTARTS it before A's due time
 * arrives to prove the schedule survives a real process replacement rather than merely a persisted
 * row on disk. Only after the restart does A's due time elapse; asserts A fires while B — due
 * minutes later — is left completely untouched, its own seeded `cleanupDueAt` read back unchanged.
 * Finally rewrites B's `cleanupDueAt` to a past value and restarts once more, proving B's schedule
 * is genuinely LIVE rather than merely surviving with no way to ever fire.
 * @remarks B, not A, is seeded as `card.activeSessionId` — deliberately, this is the shape that
 * actually discriminates a per-session scheduler from a regressed per-card one. `moveCardManual`
 * mirrors `card.cleanupDueAt` from the ACTIVE session alone, so a per-card scheduler that reads only
 * `card.cleanupDueAt` sees B's (late) due time no matter what. If the EARLY due session were also
 * the active one (the naive fixture shape), a per-card regression would coincidentally tear down the
 * right session anyway — a non-discriminating fixture the same shape as this phase's own named
 * hazard. Making A the due-but-NOT-active sibling means a per-card scheduler can only ever see B's
 * late mirror and therefore leaves A wrongly stranded forever; only a real per-session scan ever
 * reads A's own record and fires it on time.
 */
async function checkCleanupScheduleRestartFalsifiability(built) {
  const violations = [];
  const aWt = built.worktreePaths.a;
  const bWt = built.worktreePaths.b;

  // 1. Seed both sessions' due times directly, with the card already column=done.
  await killAndWait(built.server?.child);
  const cardBefore = readCard(built.dbPath, built.cardId);
  const aRecordBefore = cardBefore?.sessions?.find(
    (s) => s.id === built.sessionA.id,
  );
  const bRecordBefore = cardBefore?.sessions?.find(
    (s) => s.id === built.sessionB.id,
  );
  if (!cardBefore || !aRecordBefore || !bRecordBefore) {
    violations.push(
      `cleanup-schedule-restart: PART B VIOLATED — could not read back both session records before seeding ` +
        `(card=${!!cardBefore} a=${!!aRecordBefore} b=${!!bRecordBefore})`,
    );
    return violations;
  }
  cardBefore.column = "done";
  const scheduleStart = Date.now();
  const earlyDueAt = scheduleStart + EARLY_DUE_MS;
  const lateDueAt = scheduleStart + LATE_DUE_MS;
  // B is the ACTIVE session (due LATE); A is its non-active SIBLING (due EARLY) — see this
  // function's own @remarks for why this assignment, not the reverse, is the discriminating shape.
  // The flat mirror fields are re-pointed at B too, matching what a real setActiveSession call would
  // produce, so the seeded card is a faithful shape rather than one with a stale active projection.
  cardBefore.activeSessionId = built.sessionB.id;
  cardBefore.tmuxSession = bRecordBefore.tmuxSession;
  cardBefore.ttydPort = bRecordBefore.ttydPort;
  cardBefore.hookToken = bRecordBefore.hookToken;
  cardBefore.workspacePath = bRecordBefore.workspacePath;
  cardBefore.workspace = bRecordBefore.workspace;
  aRecordBefore.cleanupDueAt = earlyDueAt;
  bRecordBefore.cleanupDueAt = lateDueAt;
  cardBefore.cleanupDueAt = lateDueAt;

  // 2. THE PERMANENT GUARD (93-VALIDATION.md Dead-Instrument Register, row 1) — a hard,
  //    unconditional refusal, not a soft warning: the SAME-DUE-TIME break-proof (Task 2) demonstrates
  //    exactly what would silently pass without it.
  const separationMs = Math.abs(lateDueAt - earlyDueAt);
  console.log(
    `cleanup-schedule-restart: PART B — seeded due times A=${earlyDueAt} B=${lateDueAt} ` +
      `(separation=${separationMs}ms, minimum required=${DUE_TIME_MIN_SEPARATION_MS}ms)`,
  );
  if (separationMs < DUE_TIME_MIN_SEPARATION_MS) {
    violations.push(
      `cleanup-schedule-restart: DEAD-INSTRUMENT GUARD VIOLATED — seeded due times A=${earlyDueAt} and ` +
        `B=${lateDueAt} differ by only ${separationMs}ms (minimum ${DUE_TIME_MIN_SEPARATION_MS}ms) — a ` +
        `fixture this close to equal cannot distinguish real per-session scheduling from the old per-card ` +
        `scheduler that happens to see one session (93-VALIDATION.md Dead-Instrument Register, row 1)`,
    );
    return violations;
  }

  seedFixtureCard(built.home, cardBefore);

  const priorTickEnv = process.env.DISPATCH_CLEANUP_TICK_MS;
  process.env.DISPATCH_CLEANUP_TICK_MS = "500";
  try {
    // 3. Boot the sandbox server with the fast tick — THE SCHEDULE moment. Record its pid.
    built.server = bootServer(built.home);
    await waitForReady(built.port);
    const pidBeforeRestart = built.server.child.pid;
    console.log(
      `cleanup-schedule-restart: PART B — sandbox server booted (SCHEDULE) pid=${pidBeforeRestart}, ` +
        `${EARLY_DUE_MS}ms until A is due`,
    );

    // 4. RESTART BETWEEN SCHEDULE AND DUE — the part the criterion is actually about.
    if (Date.now() >= earlyDueAt) {
      violations.push(
        `cleanup-schedule-restart: PART B VIOLATED — A's due time already elapsed before the restart could ` +
          `even be attempted (now=${Date.now()}, due=${earlyDueAt}) — EARLY_DUE_MS is too small on this machine`,
      );
      return violations;
    }
    await restartServer(built);
    const pidAfterRestart = built.server.child.pid;
    console.log(
      `cleanup-schedule-restart: PART B — RESTART complete — pid before=${pidBeforeRestart} after=${pidAfterRestart}`,
    );
    if (pidAfterRestart == null || pidAfterRestart === pidBeforeRestart) {
      violations.push(
        `cleanup-schedule-restart: RESTART VIOLATED — pid before (${pidBeforeRestart}) and after ` +
          `(${pidAfterRestart}) are the same — a "restart" that did not replace the process proves nothing`,
      );
      return violations;
    }
    if (Date.now() >= earlyDueAt) {
      violations.push(
        `cleanup-schedule-restart: PART B VIOLATED — A's due time elapsed DURING the restart itself ` +
          `(now=${Date.now()}, due=${earlyDueAt}) — the restart did not happen between schedule and due, ` +
          `so this run cannot prove the criterion; widen EARLY_DUE_MS`,
      );
      return violations;
    }

    // 5. Poll for A's teardown, bounded by A's own due time plus a generous settle margin.
    const settleDeadline = earlyDueAt + SCHEDULE_RESTART_SETTLE_MARGIN_MS;
    let settledCard;
    let aGone = false;
    while (Date.now() < settleDeadline) {
      settledCard = readCard(built.dbPath, built.cardId);
      aGone =
        settledCard != null &&
        !(settledCard.sessions ?? []).some((s) => s.id === built.sessionA.id);
      if (aGone) break;
      await sleep(POLL_INTERVAL_MS);
    }
    const elapsedMs = Date.now() - scheduleStart;
    console.log(
      `cleanup-schedule-restart: PART B — A gone=${aGone}, elapsed since schedule=${elapsedMs}ms ` +
        `(LATE_DUE_MS=${LATE_DUE_MS}ms)`,
    );
    if (!aGone) {
      violations.push(
        `cleanup-schedule-restart: PART B VIOLATED — session A (due at ${earlyDueAt}) was not torn down by ` +
          `${settleDeadline} (now=${Date.now()}) — a schedule that does not survive a real restart between ` +
          `schedule and due is exactly what this check exists to catch`,
      );
      return violations;
    }

    // 6. THE ELAPSED-TIME ASSERTION — "B was untouched" must not be an artifact of this check
    //    finishing early relative to B's own due time.
    if (elapsedMs >= LATE_DUE_MS) {
      violations.push(
        `cleanup-schedule-restart: PART B VIOLATED — the observation window (${elapsedMs}ms) already reached ` +
          `LATE_DUE_MS (${LATE_DUE_MS}ms) — "B was untouched" would be meaningless if B's own due time could ` +
          `already have elapsed`,
      );
      return violations;
    }

    // 7. A-SIDE — torn down.
    const registered = await gitWorktreeListRegistered(built.repoPath);
    const aRegisteredAfter =
      existsSync(aWt) && registered.has(realpathSync(aWt));
    const aDirAfter = existsSync(aWt);
    const liveAfter = await tmuxListSessionNames();
    const aTmuxAfter = liveAfter.includes(built.tmux.a);
    const aListenAfter = await isPortListening(built.ttyd.a.port);
    console.log(
      `cleanup-schedule-restart: A-SIDE (torn down) — registered=${aRegisteredAfter} dir=${aDirAfter} ` +
        `tmux=${aTmuxAfter} ttyd(${built.ttyd.a.port})=${aListenAfter}`,
    );
    if (aRegisteredAfter) {
      violations.push(
        `cleanup-schedule-restart: A-SIDE VIOLATED — A's worktree ${aWt} is still registered in ` +
          `\`git worktree list\` after its own due time`,
      );
    }
    if (aDirAfter) {
      violations.push(
        `cleanup-schedule-restart: A-SIDE VIOLATED — A's worktree directory ${aWt} still exists on disk`,
      );
    }
    if (aTmuxAfter) {
      violations.push(
        `cleanup-schedule-restart: A-SIDE VIOLATED — A's tmux session ${built.tmux.a} is still live`,
      );
    }
    if (aListenAfter) {
      violations.push(
        `cleanup-schedule-restart: A-SIDE VIOLATED — A's ttyd port ${built.ttyd.a.port} is still LISTENING`,
      );
    }

    // 8. B-SIDE — entirely untouched, its schedule intact.
    const bRegisteredAfter =
      existsSync(bWt) && registered.has(realpathSync(bWt));
    const bDirAfter = existsSync(bWt);
    const bTmuxAfter = liveAfter.includes(built.tmux.b);
    const bListenAfter = await isPortListening(built.ttyd.b.port);
    const bRecordAfter = settledCard?.sessions?.find(
      (s) => s.id === built.sessionB.id,
    );
    console.log(
      `cleanup-schedule-restart: B-SIDE (untouched) — registered=${bRegisteredAfter} dir=${bDirAfter} ` +
        `tmux=${bTmuxAfter} ttyd(${built.ttyd.b.port})=${bListenAfter} cleanupDueAt=${bRecordAfter?.cleanupDueAt} ` +
        `(seeded=${lateDueAt})`,
    );
    if (!bRegisteredAfter) {
      violations.push(
        `cleanup-schedule-restart: B-SIDE VIOLATED — B's worktree ${bWt} is no longer registered in ` +
          `\`git worktree list\` after cleaning A — the later session was torn down early`,
      );
    }
    if (!bDirAfter) {
      violations.push(
        `cleanup-schedule-restart: B-SIDE VIOLATED — B's worktree directory ${bWt} no longer exists on disk`,
      );
    }
    if (!bTmuxAfter) {
      violations.push(
        `cleanup-schedule-restart: B-SIDE VIOLATED — B's tmux session ${built.tmux.b} is no longer live`,
      );
    }
    if (!bListenAfter) {
      violations.push(
        `cleanup-schedule-restart: B-SIDE VIOLATED — B's ttyd port ${built.ttyd.b.port} is no longer LISTENING`,
      );
    }
    if (!bRecordAfter) {
      violations.push(
        `cleanup-schedule-restart: B-SIDE VIOLATED — B's session record is missing entirely after cleaning A`,
      );
    } else if (bRecordAfter.cleanupDueAt !== lateDueAt) {
      violations.push(
        `cleanup-schedule-restart: B-SIDE VIOLATED — B's cleanupDueAt changed from the seeded ${lateDueAt} to ` +
          `${bRecordAfter.cleanupDueAt} — a schedule must not be cleared, re-minted, or advanced by cleaning ` +
          `a sibling`,
      );
    }
    if (violations.length > 0) return violations;

    // 9. B's schedule is LIVE, not merely surviving: rewrite it to a past value and prove it fires on
    //    a subsequent tick, through one more real restart.
    const cardForBSweep = readCard(built.dbPath, built.cardId);
    const bRecordForSweep = cardForBSweep?.sessions?.find(
      (s) => s.id === built.sessionB.id,
    );
    if (!cardForBSweep || !bRecordForSweep) {
      violations.push(
        `cleanup-schedule-restart: PART B VIOLATED — could not read back B's record before the final sweep`,
      );
      return violations;
    }
    const bPastDueAt = Date.now() - 5_000;
    bRecordForSweep.cleanupDueAt = bPastDueAt;
    cardForBSweep.cleanupDueAt = bPastDueAt;
    await killAndWait(built.server.child);
    seedFixtureCard(built.home, cardForBSweep);
    console.log(
      `cleanup-schedule-restart: PART B — B's cleanupDueAt adversarially rewritten to a past value ` +
        `(${bPastDueAt}), restarting once more to prove the schedule fires`,
    );
    built.server = bootServer(built.home);
    await waitForReady(built.port);

    const finalDeadline = Date.now() + SCHEDULE_RESTART_SETTLE_MARGIN_MS;
    let bGone = false;
    while (Date.now() < finalDeadline) {
      const finalCard = readCard(built.dbPath, built.cardId);
      bGone =
        finalCard != null &&
        !(finalCard.sessions ?? []).some((s) => s.id === built.sessionB.id);
      if (bGone) break;
      await sleep(POLL_INTERVAL_MS);
    }
    console.log(
      `cleanup-schedule-restart: PART B — B's own eventual teardown — gone=${bGone} within ` +
        `${SCHEDULE_RESTART_SETTLE_MARGIN_MS}ms of the final restart`,
    );
    if (!bGone) {
      violations.push(
        `cleanup-schedule-restart: PART B VIOLATED — B was never torn down on its own due time — a schedule ` +
          `that survives a restart but never fires is not a schedule`,
      );
    }
  } finally {
    if (priorTickEnv === undefined) delete process.env.DISPATCH_CLEANUP_TICK_MS;
    else process.env.DISPATCH_CLEANUP_TICK_MS = priorTickEnv;
  }

  return violations;
}

/**
 * `--check cleanup-schedule-restart` (Phase 93 criterion 2): PART A proves a genuine Done arrival
 * stamps `cleanupDueAt` on EVERY session a ticket owns, in a fresh fixture cycle. PART B, in ANOTHER
 * fresh fixture cycle, seeds two sessions with genuinely DIFFERENT due times directly into the
 * sandbox `board.db`, restarts the real backend BETWEEN the schedule and the earlier due time, and
 * proves the earlier session fires while the later one — and its own schedule — survive untouched,
 * then proves that surviving schedule is genuinely live by adversarially firing it through one more
 * restart. Both facts are required in the same run: neither alone settles criterion 2
 * (93-VALIDATION.md's own Interfaces note).
 */
async function checkCleanupScheduleRestart() {
  const violations = [];
  violations.push(
    ...(await withFixture(
      "cleanup-schedule-restart-product-path",
      checkCleanupScheduleRestartProductPath,
      WORKTREE_FIXTURE,
    )),
  );
  violations.push(
    ...(await withFixture(
      "cleanup-schedule-restart-falsifiability",
      checkCleanupScheduleRestartFalsifiability,
      WORKTREE_FIXTURE,
    )),
  );
  return violations;
}

/**
 * Sorted list of every tracked-or-untracked file under `worktreePath`, `.git` excluded — the
 * "worktree file set" isolation assertions (Plan 94-05) compare before/after, so a session-2
 * creation that ever wrote into session 1's own worktree directory (a wrong-target bug, not merely
 * a wrong-name one) would surface here even if every named-file/porcelain assertion missed it.
 */
async function listWorktreeFiles(worktreePath) {
  const { stdout } = await execFileP("find", [
    worktreePath,
    "-type",
    "f",
    "-not",
    "-path",
    "*/.git/*",
  ]);
  return stdout
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .sort();
}

/**
 * `--check second-session-fixture` (Plan 94-05 Task 1): the direct analog of Phase 93's
 * `cleanup-fixture` for {@link SECOND_SESSION_FIXTURE} — stands the fixture up, drives ONE real
 * `POST /start {newSession:true}` through the real route, waits for the saga to settle, and
 * asserts the fixture itself came up the way a real second start would. Exists so a fixture
 * failure is diagnosable AS a fixture failure, never mistaken for a product defect by the
 * criterion checks ({@link checkSecondSessionIsolation}) that build on it.
 */
async function checkSecondSessionFixture(built) {
  const violations = [];

  const { status, body } = await startSecondSession(built, {
    newSession: true,
  });
  console.log(
    `second-session-fixture: POST /start {newSession:true} -> ${status}`,
  );
  if (status !== 202) {
    violations.push(
      `second-session-fixture: POST /start returned ${status}, expected 202 (body=${JSON.stringify(body)})`,
    );
    return violations;
  }

  const { card, timedOut } = await waitForSagaSettled(built, {
    timeoutMs: SECOND_SESSION_SAGA_TIMEOUT_MS,
  });
  if (timedOut) {
    violations.push(
      `second-session-fixture: saga did not settle within ${SECOND_SESSION_SAGA_TIMEOUT_MS}ms (last observed card=${JSON.stringify(card)})`,
    );
    return violations;
  }
  if (card?.startError != null) {
    violations.push(
      `second-session-fixture: saga recorded a startError instead of a second session: ${JSON.stringify(card.startError)}`,
    );
    return violations;
  }

  const session1Name = built.tmux.a;
  const session2Name = `dsp-${built.identifier}-2`;
  console.log(
    `second-session-fixture: session 1 = ${session1Name}, session 2 = ${session2Name}`,
  );

  const summaryCount = card?.sessionSummaries?.length ?? 0;
  if (summaryCount !== 2) {
    violations.push(
      `second-session-fixture: card.sessionSummaries has ${summaryCount} entries, expected 2 (${JSON.stringify(card?.sessionSummaries)})`,
    );
  }

  const live = await tmuxListSessionNames();
  if (!live.includes(session1Name)) {
    violations.push(
      `second-session-fixture: session 1's exact tmux name ${session1Name} not found in list-sessions: ${JSON.stringify(live)}`,
    );
  }
  if (!live.includes(session2Name)) {
    violations.push(
      `second-session-fixture: session 2's exact tmux name ${session2Name} not found in list-sessions: ${JSON.stringify(live)}`,
    );
  }

  const registered = await gitWorktreeListRegistered(built.repoPath);
  const session1Wt = existsSync(built.session1WorktreePath)
    ? realpathSync(built.session1WorktreePath)
    : built.session1WorktreePath;
  if (!registered.has(session1Wt)) {
    violations.push(
      `second-session-fixture: session 1 worktree not registered in \`git worktree list\`: ${built.session1WorktreePath} (registered=${[...registered].join(", ")})`,
    );
  }
  const session2WorkspacePath = join(
    built.home,
    "workspaces",
    `${built.identifier}-2`,
  );
  const session2WtPath = join(session2WorkspacePath, "alpha");
  const session2Wt = existsSync(session2WtPath)
    ? realpathSync(session2WtPath)
    : session2WtPath;
  if (!registered.has(session2Wt)) {
    violations.push(
      `second-session-fixture: session 2 worktree not registered in \`git worktree list\`: ${session2WtPath} (registered=${[...registered].join(", ")})`,
    );
  }

  const { stdout: branchOut } = await execFileP("git", ["branch", "--list"], {
    cwd: built.repoPath,
  });
  if (!branchOut.includes(built.identifier)) {
    violations.push(
      `second-session-fixture: session 1's branch not found in \`git branch --list\`: ${built.identifier}`,
    );
  }
  if (!branchOut.includes(`${built.identifier}-2`)) {
    violations.push(
      `second-session-fixture: session 2's branch not found in \`git branch --list\`: ${built.identifier}-2`,
    );
  }

  console.log(
    `second-session-fixture: registered worktrees=[${[...registered].join(", ")}] branches=[${built.identifier}, ${built.identifier}-2]`,
  );

  return violations;
}

/**
 * `--check second-session-isolation` (Plan 94-05 Task 2, criterion C1, MULTI-01/START-01): drives
 * the REAL start saga end to end and proves session 1 keeps its worktree, its terminal, and its
 * ability to ANSWER while session 2 is created — plus the FAN-OUT shape (94-VALIDATION.md's
 * standing rule: isolation alone risks passing vacuously; only fan-out proved the Phase 93
 * regression).
 * @remarks Every tmux survival assertion below compares against session 1's EXACT recorded name
 * (`.includes(exactName)`/`===`), never a count and never `startsWith` — the tmux 3.6a prefix-match
 * trap this whole plan exists to close.
 */
async function checkSecondSessionIsolation(built) {
  const violations = [];

  const session1Name = built.tmux.a;
  const session2Name = `dsp-${built.identifier}-2`;

  writeFileSync(
    join(built.session1WorktreePath, "session-a.txt"),
    "uncommitted isolation-check edit\n",
    { flag: "a" },
  );

  const beforeHead = (
    await execFileP("git", ["rev-parse", "HEAD"], {
      cwd: built.session1WorktreePath,
    })
  ).stdout.trim();
  const beforePorcelain = (
    await execFileP("git", ["status", "--porcelain"], {
      cwd: built.session1WorktreePath,
    })
  ).stdout;
  const beforeFiles = await listWorktreeFiles(built.session1WorktreePath);
  console.log(
    `second-session-isolation: session 1 BEFORE — HEAD=${beforeHead} porcelain=${JSON.stringify(beforePorcelain)} files=${JSON.stringify(beforeFiles)}`,
  );

  const marker1 = `pre-second-start-${randomBytes(4).toString("hex")}`;
  await writePaneMarker(session1Name, built.home, marker1);
  const read1 = await readPaneThroughProxy({
    port: built.port,
    idSegment: built.sessionA.id,
    expect: marker1,
    timeoutMs: PROXY_READ_TIMEOUT_MS,
  });
  console.log(
    `second-session-isolation: session 1 answerable BEFORE the second start — found=${read1.text.includes(marker1)}`,
  );
  if (!read1.text.includes(marker1)) {
    violations.push(
      `second-session-isolation: session 1 did not echo marker "${marker1}" through the proxy BEFORE the second start — the fixture itself is not answerable, so no later claim about it is meaningful`,
    );
    return violations;
  }

  const { status, body } = await startSecondSession(built, {
    newSession: true,
  });
  console.log(
    `second-session-isolation: POST /start {newSession:true} -> ${status}`,
  );
  if (status !== 202) {
    violations.push(
      `second-session-isolation: POST /start returned ${status}, expected 202 (body=${JSON.stringify(body)})`,
    );
    return violations;
  }

  const { card, timedOut } = await waitForSagaSettled(built, {
    timeoutMs: SECOND_SESSION_SAGA_TIMEOUT_MS,
  });
  if (timedOut) {
    violations.push(
      `second-session-isolation: saga did not settle within ${SECOND_SESSION_SAGA_TIMEOUT_MS}ms (last observed card=${JSON.stringify(card)})`,
    );
    return violations;
  }
  if (card?.startError != null) {
    violations.push(
      `second-session-isolation: saga recorded a startError instead of a second session: ${JSON.stringify(card.startError)}`,
    );
    return violations;
  }

  // --- FAN-OUT: assert everything that should be RIGHT, not only that nothing was touched. ---
  const live = await tmuxListSessionNames();
  console.log(
    `second-session-isolation: tmux list-sessions after second start = ${JSON.stringify(live)}`,
  );
  if (!live.includes(session1Name)) {
    violations.push(
      `second-session-isolation: session 1's EXACT tmux name ${session1Name} not found in list-sessions after the second start: ${JSON.stringify(live)}`,
    );
  }
  if (!live.includes(session2Name)) {
    violations.push(
      `second-session-isolation: session 2's EXACT tmux name ${session2Name} not found in list-sessions: ${JSON.stringify(live)}`,
    );
  }

  const summaryIds = (card?.sessionSummaries ?? []).map((s) => s.id);
  if (summaryIds.length !== 2 || new Set(summaryIds).size !== 2) {
    violations.push(
      `second-session-isolation: card.sessionSummaries should carry exactly 2 DISTINCT session ids, got ${JSON.stringify(summaryIds)}`,
    );
  }

  const persisted = readCard(built.dbPath, built.cardId);
  const persistedSessions = persisted?.sessions ?? [];
  if (persistedSessions.length !== 2) {
    violations.push(
      `second-session-isolation: persisted card.sessions has ${persistedSessions.length} records, expected 2`,
    );
  }
  const [recA, recB] = persistedSessions;
  if (recA && recB) {
    const sixValues = [
      recA.tmuxSession,
      recA.branch,
      recA.workspacePath,
      recB.tmuxSession,
      recB.branch,
      recB.workspacePath,
    ];
    console.log(
      `second-session-isolation: persisted session fields — A=${JSON.stringify({ tmuxSession: recA.tmuxSession, branch: recA.branch, workspacePath: recA.workspacePath })} B=${JSON.stringify({ tmuxSession: recB.tmuxSession, branch: recB.branch, workspacePath: recB.workspacePath })}`,
    );
    if (new Set(sixValues).size !== 6) {
      violations.push(
        `second-session-isolation: persisted session records must carry SIX pairwise-distinct values (tmuxSession/branch/workspacePath x2), got ${JSON.stringify(sixValues)}`,
      );
    }
  }

  const registeredAfter = await gitWorktreeListRegistered(built.repoPath);
  const session1Wt = existsSync(built.session1WorktreePath)
    ? realpathSync(built.session1WorktreePath)
    : built.session1WorktreePath;
  const session2WtPath = join(
    built.home,
    "workspaces",
    `${built.identifier}-2`,
    "alpha",
  );
  const session2Wt = existsSync(session2WtPath)
    ? realpathSync(session2WtPath)
    : session2WtPath;
  if (!registeredAfter.has(session1Wt)) {
    violations.push(
      `second-session-isolation: session 1 worktree missing from \`git worktree list\` after the second start: ${built.session1WorktreePath}`,
    );
  }
  if (!registeredAfter.has(session2Wt)) {
    violations.push(
      `second-session-isolation: session 2 worktree missing from \`git worktree list\`: ${session2WtPath} (registered=${[...registeredAfter].join(", ")})`,
    );
  }

  // --- ISOLATION: session 1's own worktree is byte-identical to its BEFORE state. ---
  const afterHead = (
    await execFileP("git", ["rev-parse", "HEAD"], {
      cwd: built.session1WorktreePath,
    })
  ).stdout.trim();
  const afterPorcelain = (
    await execFileP("git", ["status", "--porcelain"], {
      cwd: built.session1WorktreePath,
    })
  ).stdout;
  const afterFiles = await listWorktreeFiles(built.session1WorktreePath);
  console.log(
    `second-session-isolation: session 1 AFTER — HEAD=${afterHead} porcelain=${JSON.stringify(afterPorcelain)} files=${JSON.stringify(afterFiles)}`,
  );
  if (afterHead !== beforeHead) {
    violations.push(
      `second-session-isolation: session 1's HEAD changed — before=${beforeHead} after=${afterHead}`,
    );
  }
  if (afterPorcelain !== beforePorcelain) {
    violations.push(
      `second-session-isolation: session 1's \`git status --porcelain\` changed — before=${JSON.stringify(beforePorcelain)} after=${JSON.stringify(afterPorcelain)}`,
    );
  }
  if (JSON.stringify(afterFiles) !== JSON.stringify(beforeFiles)) {
    violations.push(
      `second-session-isolation: session 1's worktree file set changed — before=${JSON.stringify(beforeFiles)} after=${JSON.stringify(afterFiles)}`,
    );
  }

  // --- ANSWERABILITY: the criterion's own bar — a directory surviving is not enough. ---
  const marker2 = `post-second-start-${randomBytes(4).toString("hex")}`;
  await writePaneMarker(session1Name, built.home, marker2);
  const read2 = await readPaneThroughProxy({
    port: built.port,
    idSegment: built.sessionA.id,
    expect: marker2,
    timeoutMs: PROXY_READ_TIMEOUT_MS,
  });
  console.log(
    `second-session-isolation: session 1 answerable AFTER the second start — found=${read2.text.includes(marker2)}`,
  );
  if (!read2.text.includes(marker2)) {
    violations.push(
      `second-session-isolation: session 1 did not echo marker "${marker2}" through the proxy AFTER the second start — a directory surviving is not the same as session 1 still ANSWERING`,
    );
  }

  return violations;
}

/**
 * `--check naming-consistency` (Plan 94-06 Task 1, criterion C2, START-01): drives the REAL start
 * saga end to end and proves the tmux session name, the branch and the per-repo worktree
 * directory ALL reduce to session 2's persisted `branch` field — never merely that the three
 * public artifacts look right while some other internal derivation (`steps.ts`) could silently
 * diverge from it.
 * @remarks Every derived value is computed from `token` (session 2's persisted `branch` — the
 * value `steps.ts` passes straight to git with no further transformation) or from the sandbox's
 * own `config.json`, never read back from the SAME record being validated — a
 * `record.x === record.x` comparison would prove nothing (94-VALIDATION.md's standing rule).
 */
async function checkNamingConsistency(built) {
  const violations = [];

  const session1Name = built.tmux.a;

  writeFileSync(
    join(built.session1WorktreePath, "session-a.txt"),
    "uncommitted naming-consistency check edit\n",
    { flag: "a" },
  );

  const beforeHead = (
    await execFileP("git", ["rev-parse", "HEAD"], {
      cwd: built.session1WorktreePath,
    })
  ).stdout.trim();
  const beforePorcelain = (
    await execFileP("git", ["status", "--porcelain"], {
      cwd: built.session1WorktreePath,
    })
  ).stdout;
  console.log(
    `naming-consistency: session 1 BEFORE — HEAD=${beforeHead} porcelain=${JSON.stringify(beforePorcelain)}`,
  );

  const { status, body } = await startSecondSession(built, {
    newSession: true,
  });
  console.log(`naming-consistency: POST /start {newSession:true} -> ${status}`);
  if (status !== 202) {
    violations.push(
      `naming-consistency: POST /start returned ${status}, expected 202 (body=${JSON.stringify(body)})`,
    );
    return violations;
  }

  const { card: liveCard, timedOut } = await waitForSagaSettled(built, {
    timeoutMs: SECOND_SESSION_SAGA_TIMEOUT_MS,
  });
  if (timedOut) {
    violations.push(
      `naming-consistency: saga did not settle within ${SECOND_SESSION_SAGA_TIMEOUT_MS}ms (last observed card=${JSON.stringify(liveCard)})`,
    );
    return violations;
  }
  if (liveCard?.startError != null) {
    violations.push(
      `naming-consistency: saga recorded a startError instead of a second session: ${JSON.stringify(liveCard.startError)}`,
    );
    return violations;
  }

  const persisted = readCard(built.dbPath, built.cardId);
  const persistedSessions = persisted?.sessions ?? [];
  if (persistedSessions.length !== 2) {
    violations.push(
      `naming-consistency: persisted card.sessions has ${persistedSessions.length} records, expected 2`,
    );
    return violations;
  }
  const session1Record = persistedSessions.find(
    (s) => s.id === built.sessionA.id,
  );
  const session2Record = persistedSessions.find(
    (s) => s.id !== built.sessionA.id,
  );
  if (!session1Record || !session2Record) {
    violations.push(
      `naming-consistency: could not resolve session 1 (${built.sessionA.id}) among persisted records ${JSON.stringify(persistedSessions.map((s) => s.id))}`,
    );
    return violations;
  }

  // The single suffix token: session 2's persisted `branch`.
  const token = session2Record.branch;
  const ordinal = (persisted?.nextSessionOrdinal ?? 3) - 1;
  console.log(
    `naming-consistency: derived token (session 2's persisted branch) = "${token}", ordinal = ${ordinal}`,
  );

  // 2. tmux name, derived from token — never compared against session2Record's own field twice.
  const expectedTmux = `dsp-${token}`;
  if (session2Record.tmuxSession !== expectedTmux) {
    violations.push(
      `naming-consistency: session 2 tmuxSession expected "${expectedTmux}" (derived from token "${token}"), got "${session2Record.tmuxSession}"`,
    );
  }

  // 3. workspacePath, derived from the sandbox's OWN config.json workspaceRoot + token.
  const config = JSON.parse(
    readFileSync(join(built.home, DISPATCH_DIR_NAME, "config.json"), "utf8"),
  );
  const expectedWorkspacePath = join(config.workspaceRoot, token);
  if (session2Record.workspacePath !== expectedWorkspacePath) {
    violations.push(
      `naming-consistency: session 2 workspacePath expected "${expectedWorkspacePath}" (config.workspaceRoot + token), got "${session2Record.workspacePath}"`,
    );
  }

  // 4. the per-repo worktree directory on disk, derived from production's own worktreePath(), and
  // the branch `git worktree list --porcelain` reports it attached to.
  const { worktreePath } = await loadWorkspacePathsAdapter();
  const expectedWtPath = worktreePath(expectedWorkspacePath, built.repoPath);
  if (!existsSync(expectedWtPath)) {
    violations.push(
      `naming-consistency: session 2 worktree directory missing on disk: ${expectedWtPath}`,
    );
  }
  const { stdout: porcelain } = await execFileP(
    "git",
    ["worktree", "list", "--porcelain"],
    { cwd: built.repoPath },
  );
  const worktreeBranches = new Map();
  let currentPath;
  for (const line of porcelain.split("\n")) {
    if (line.startsWith("worktree ")) {
      currentPath = line.slice("worktree ".length);
    } else if (line.startsWith("branch refs/heads/") && currentPath) {
      worktreeBranches.set(
        currentPath,
        line.slice("branch refs/heads/".length),
      );
    }
  }
  const resolvedExpectedWtPath = existsSync(expectedWtPath)
    ? realpathSync(expectedWtPath)
    : expectedWtPath;
  const registeredEntry = [...worktreeBranches.entries()].find(
    ([p]) => (existsSync(p) ? realpathSync(p) : p) === resolvedExpectedWtPath,
  );
  console.log(
    `naming-consistency: git worktree list --porcelain (path -> branch) = ${JSON.stringify([...worktreeBranches.entries()])}`,
  );
  if (registeredEntry?.[1] !== token) {
    violations.push(
      `naming-consistency: \`git worktree list --porcelain\` reports branch "${registeredEntry?.[1]}" for ${expectedWtPath}, expected "${token}"`,
    );
  }

  // 5. token derived from the monotonic ordinal, not from sessions.length.
  const expectedToken = `${built.identifier}-${ordinal}`;
  if (token !== expectedToken) {
    violations.push(
      `naming-consistency: token "${token}" does not equal "\${identifier}-\${ordinal}" = "${expectedToken}" (card.nextSessionOrdinal=${persisted?.nextSessionOrdinal})`,
    );
  }

  // 6. session 1's three names are UNCHANGED and carry NO suffix — KEEP-02's parity break.
  const expectedSession1Tmux = `dsp-${built.identifier}`;
  const expectedSession1Workspace = join(
    config.workspaceRoot,
    built.identifier,
  );
  if (session1Record.tmuxSession !== expectedSession1Tmux) {
    violations.push(
      `naming-consistency: session 1 tmuxSession expected "${expectedSession1Tmux}" (unchanged), got "${session1Record.tmuxSession}"`,
    );
  }
  if (session1Record.branch !== built.identifier) {
    violations.push(
      `naming-consistency: session 1 branch expected "${built.identifier}" (unchanged), got "${session1Record.branch}"`,
    );
  }
  if (session1Record.workspacePath !== expectedSession1Workspace) {
    violations.push(
      `naming-consistency: session 1 workspacePath expected "${expectedSession1Workspace}" (unchanged), got "${session1Record.workspacePath}"`,
    );
  }
  console.log(
    `naming-consistency: session 1 names — tmuxSession=${session1Record.tmuxSession} branch=${session1Record.branch} workspacePath=${session1Record.workspacePath}`,
  );
  console.log(
    `naming-consistency: session 2 names — tmuxSession=${session2Record.tmuxSession} branch=${session2Record.branch} workspacePath=${session2Record.workspacePath}`,
  );

  // 7. session 1's HEAD and porcelain status are byte-identical — starting the second never
  // mutates the first.
  const afterHead = (
    await execFileP("git", ["rev-parse", "HEAD"], {
      cwd: built.session1WorktreePath,
    })
  ).stdout.trim();
  const afterPorcelain = (
    await execFileP("git", ["status", "--porcelain"], {
      cwd: built.session1WorktreePath,
    })
  ).stdout;
  console.log(
    `naming-consistency: session 1 AFTER — HEAD=${afterHead} porcelain=${JSON.stringify(afterPorcelain)}`,
  );
  if (afterHead !== beforeHead) {
    violations.push(
      `naming-consistency: session 1's HEAD changed — before=${beforeHead} after=${afterHead}`,
    );
  }
  if (afterPorcelain !== beforePorcelain) {
    violations.push(
      `naming-consistency: session 1's \`git status --porcelain\` changed — before=${JSON.stringify(beforePorcelain)} after=${JSON.stringify(afterPorcelain)}`,
    );
  }

  console.log(
    `naming-consistency: session 1 tmux name (unchanged throughout) = ${session1Name}`,
  );

  return violations;
}

/**
 * `--check reserve-coalesce` (Plan 94-06 Task 2, criterion C4, START-02): fires two REAL,
 * concurrent `POST /start {newSession:true}` requests with no `await` between them and asserts
 * they COALESCE onto exactly one new session — the card-level `isStarting`/`beginStart` gate is
 * what serializes the reserve step; a per-session lock could never catch this because two
 * concurrent requests mint two DIFFERENT session ids, so a per-session key can never collide.
 * @remarks Every assertion here is measured against the outcome of a genuine race, not reasoned
 * about — no `await` separates the two {@link startSecondSession} calls below, so both requests
 * are in flight before either resolves (94-VALIDATION.md's C4 row).
 */
async function checkReserveCoalesce(built) {
  const violations = [];

  const session1Name = built.tmux.a;

  const before = readCard(built.dbPath, built.cardId);
  const ordinalBefore = before?.nextSessionOrdinal ?? 2;
  console.log(
    `reserve-coalesce: card.nextSessionOrdinal BEFORE = ${ordinalBefore}`,
  );

  const [result1, result2] = await Promise.all([
    startSecondSession(built, { newSession: true }),
    startSecondSession(built, { newSession: true }),
  ]);
  console.log(
    `reserve-coalesce: POST 1 -> ${result1.status}, POST 2 -> ${result2.status}`,
  );
  [result1, result2].forEach((r, i) => {
    if (r.status >= 400) {
      violations.push(
        `reserve-coalesce: POST ${i + 1} returned error status ${r.status} (body=${JSON.stringify(r.body)}) — the locked behaviour is coalescing, not refusal`,
      );
    }
  });

  const { card, timedOut } = await waitForSagaSettled(built, {
    timeoutMs: SECOND_SESSION_SAGA_TIMEOUT_MS,
  });
  if (timedOut) {
    violations.push(
      `reserve-coalesce: saga did not settle within ${SECOND_SESSION_SAGA_TIMEOUT_MS}ms (last observed card=${JSON.stringify(card)})`,
    );
    return violations;
  }
  if (card?.startError != null) {
    violations.push(
      `reserve-coalesce: saga recorded a startError: ${JSON.stringify(card.startError)}`,
    );
  }

  const persisted = readCard(built.dbPath, built.cardId);
  const persistedSessions = persisted?.sessions ?? [];
  console.log(
    `reserve-coalesce: persisted card.sessions after settle = ${JSON.stringify(persistedSessions.map((s) => ({ id: s.id, tmuxSession: s.tmuxSession, branch: s.branch })))}`,
  );

  // 1. Exactly ONE new session — the persisted card has exactly 2 session records, not 3.
  if (persistedSessions.length !== 2) {
    violations.push(
      `reserve-coalesce: persisted card.sessions has ${persistedSessions.length} records, expected exactly 2 (one coalesced new session, not two)`,
    );
  }

  // 2. card.nextSessionOrdinal advanced by exactly 1, not 2 — the reservation ledger.
  const ordinalAfter = persisted?.nextSessionOrdinal ?? ordinalBefore;
  console.log(
    `reserve-coalesce: card.nextSessionOrdinal AFTER = ${ordinalAfter} (before=${ordinalBefore})`,
  );
  if (ordinalAfter - ordinalBefore !== 1) {
    violations.push(
      `reserve-coalesce: card.nextSessionOrdinal advanced by ${ordinalAfter - ordinalBefore}, expected exactly 1 (before=${ordinalBefore}, after=${ordinalAfter})`,
    );
  }

  // 3. tmux list-sessions contains exactly ONE name matching dsp-<identifier>-<digits>.
  const live = await tmuxListSessionNames();
  const suffixRe = new RegExp(`^dsp-${built.identifier}-\\d+$`);
  const suffixedMatches = live.filter((n) => suffixRe.test(n));
  console.log(
    `reserve-coalesce: tmux list-sessions = ${JSON.stringify(live)}; suffixed matches = ${JSON.stringify(suffixedMatches)}`,
  );
  if (suffixedMatches.length !== 1) {
    violations.push(
      `reserve-coalesce: tmux list-sessions has ${suffixedMatches.length} names matching dsp-${built.identifier}-<digits>, expected exactly 1 — found ${JSON.stringify(suffixedMatches)}`,
    );
  }

  // 4. git branch --list has exactly one <identifier>-<digits> branch; exactly two SESSION
  // worktrees (excluding the fixture repo's own primary working tree, which git refuses to
  // "worktree remove" and which is not a session worktree to begin with).
  const { stdout: branchOut } = await execFileP("git", ["branch", "--list"], {
    cwd: built.repoPath,
  });
  const branchRe = new RegExp(`^${built.identifier}-\\d+$`);
  const branchNames = branchOut
    .split("\n")
    .map((l) => l.replace(/^[*+ ]+/, "").trim())
    .filter((l) => branchRe.test(l));
  console.log(
    `reserve-coalesce: git branch --list suffixed matches = ${JSON.stringify(branchNames)}`,
  );
  if (branchNames.length !== 1) {
    violations.push(
      `reserve-coalesce: \`git branch --list\` has ${branchNames.length} branches matching ${built.identifier}-<digits>, expected exactly 1 — found ${JSON.stringify(branchNames)}`,
    );
  }

  const registered = await gitWorktreeListRegistered(built.repoPath);
  const mainWorktree = realpathSync(built.repoPath);
  const sessionWorktrees = [...registered].filter((p) => p !== mainWorktree);
  console.log(
    `reserve-coalesce: git worktree list --porcelain (session worktrees, excluding main) = ${JSON.stringify(sessionWorktrees)}`,
  );
  if (sessionWorktrees.length !== 2) {
    violations.push(
      `reserve-coalesce: \`git worktree list --porcelain\` has ${sessionWorktrees.length} session worktrees (excluding the primary working tree), expected exactly 2 — found ${JSON.stringify(sessionWorktrees)}`,
    );
  }

  // 6. session 1's exact tmux name is still present.
  if (!live.includes(session1Name)) {
    violations.push(
      `reserve-coalesce: session 1's EXACT tmux name ${session1Name} not found in list-sessions: ${JSON.stringify(live)}`,
    );
  }

  return violations;
}

/**
 * Count field declarations of type `StartError` inside one top-level `export interface <name> {
 * ... }` block of `source`, by brace-depth scanning from the interface's own opening brace to its
 * matching close — never a whole-file `grep`, so a `StartError` mention inside another interface
 * or a JSDoc comment can never inflate the count for `name`.
 */
function countStartErrorFieldsInInterface(source, name) {
  const openMarker = `export interface ${name} {`;
  const markerStart = source.indexOf(openMarker);
  if (markerStart === -1) {
    throw new Error(
      `countStartErrorFieldsInInterface: "${openMarker}" not found in types.ts`,
    );
  }
  let depth = 1;
  let i = markerStart + openMarker.length;
  for (; i < source.length && depth > 0; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") depth--;
  }
  const body = source.slice(markerStart + openMarker.length, i - 1);
  return (body.match(/:\s*StartError\b/g) ?? []).length;
}

/**
 * The wire-shape assertion shared by both directions (C3's own "no second `startError`-shaped
 * field entered `Card` or `Session`"): reads `src/shared/types.ts` fresh off disk and counts
 * `StartError`-typed fields per interface, rather than grepping for the substring "error" (which
 * would also match `TerminalError`, `resumeError`, etc.) or comparing against a hardcoded count
 * with no attribution to WHICH field. `StartError.newSession` (Phase 94) is a widening of the one
 * existing `Card.startError` channel, not a second channel — stated explicitly here rather than
 * merely assumed.
 */
function checkStartErrorWireShape(label) {
  const violations = [];
  const source = readFileSync(
    join(REPO_ROOT, "src", "shared", "types.ts"),
    "utf8",
  );
  const cardCount = countStartErrorFieldsInInterface(source, "Card");
  const sessionCount = countStartErrorFieldsInInterface(source, "Session");
  console.log(
    `second-start-rollback (${label}): StartError-typed fields — Card=${cardCount} Session=${sessionCount}`,
  );
  if (cardCount !== 1) {
    violations.push(
      `second-start-rollback (${label}): expected exactly 1 StartError-typed field on Card, found ${cardCount}`,
    );
  }
  if (sessionCount !== 0) {
    violations.push(
      `second-start-rollback (${label}): expected 0 StartError-typed fields on Session, found ${sessionCount} — StartError.newSession is a widening of the ONE existing channel on Card, never a second channel`,
    );
  }
  return violations;
}

/**
 * Direction 1 (Plan 94-07 Task 1/2, criterion C3, START-02): a failing SECOND start must not
 * disturb session 1. Forces the cheapest reproducible failure — a branch-name collision — by
 * planting a scratch worktree attached to the branch the saga's own reservation will pick
 * (`<identifier>-2`, session 1 being the only existing session), so `createWorktrees`'
 * `worktreeAddExistingBranch` hits `is already used by worktree at` and throws the PRE-EXISTING
 * `"branch-conflict"` variant (no new variant added by this phase). The collision fires in
 * `createWorktrees`, BEFORE `startClaude` ever runs — `ctx.tmuxSessionCreated` stays `false`, so
 * `startClaude.undo`'s kill is never even attempted here. That is precisely why this direction
 * proves Break A (the zombie-record rollback) and NOT Break B (the tmux prefix-kill) — see
 * {@link checkSecondStartRollbackDirection2} for the direction that reaches `startClaude.undo`.
 */
async function checkSecondStartRollbackDirection1(built) {
  const violations = [];
  const session1Name = built.tmux.a;

  const { worktreeAddNewBranch, worktreeRemove } = await loadGitAdapter();
  const collisionBranch = `${built.identifier}-2`;
  const collisionWtPath = join(built.home, "scratch-collision");
  assertUnderTmpdir(collisionWtPath, "direction 1 scratch collision worktree");
  await worktreeAddNewBranch(
    built.repoPath,
    collisionWtPath,
    collisionBranch,
    built.repoBase,
  );
  console.log(
    `second-start-rollback (d1): planted collision — branch "${collisionBranch}" attached at ${collisionWtPath}`,
  );

  const before = readCard(built.dbPath, built.cardId);
  const ordinalBefore = before?.nextSessionOrdinal ?? 2;

  const { status, body } = await startSecondSession(built, {
    newSession: true,
  });
  console.log(
    `second-start-rollback (d1): POST /start {newSession:true} -> ${status}`,
  );
  if (status !== 202) {
    violations.push(
      `second-start-rollback (d1): POST /start returned ${status}, expected 202 (body=${JSON.stringify(body)})`,
    );
    return violations;
  }

  const { card, timedOut } = await waitForSagaSettled(built, {
    timeoutMs: SECOND_SESSION_SAGA_TIMEOUT_MS,
  });
  if (timedOut) {
    violations.push(
      `second-start-rollback (d1): saga did not settle within ${SECOND_SESSION_SAGA_TIMEOUT_MS}ms (last observed card=${JSON.stringify(card)})`,
    );
    return violations;
  }

  // 1. the pre-existing branch-conflict variant, carrying newSession:true.
  console.log(
    `second-start-rollback (d1): startError = ${JSON.stringify(card?.startError)}`,
  );
  if (card?.startError?.variant !== "branch-conflict") {
    violations.push(
      `second-start-rollback (d1): startError.variant expected "branch-conflict", got ${JSON.stringify(card?.startError)}`,
    );
  }
  if (card?.startError?.newSession !== true) {
    violations.push(
      `second-start-rollback (d1): startError.newSession expected true, got ${JSON.stringify(card?.startError?.newSession)}`,
    );
  }

  // 2. exactly ONE session record — the reservation was removed entirely, no `failed` tombstone.
  const persistedAfterFail = readCard(built.dbPath, built.cardId);
  const sessionsAfterFail = persistedAfterFail?.sessions ?? [];
  console.log(
    `second-start-rollback (d1): persisted card.sessions after the failed second start = ${JSON.stringify(sessionsAfterFail.map((s) => ({ id: s.id, tmuxSession: s.tmuxSession })))}`,
  );
  if (sessionsAfterFail.length !== 1) {
    violations.push(
      `second-start-rollback (d1): persisted card.sessions has ${sessionsAfterFail.length} records after the failed second start, expected exactly 1 (the reservation must be removed entirely)`,
    );
  }

  // 3. session 1's EXACT tmux name survives.
  const liveAfterFail = await tmuxListSessionNames();
  console.log(
    `second-start-rollback (d1): tmux list-sessions after the failed second start = ${JSON.stringify(liveAfterFail)}`,
  );
  if (!liveAfterFail.includes(session1Name)) {
    violations.push(
      `second-start-rollback (d1): session 1's EXACT tmux name ${session1Name} not found in list-sessions: ${JSON.stringify(liveAfterFail)}`,
    );
  }

  // 4. session 1's terminal still ANSWERS — a surviving name is not a surviving session.
  const marker1 = `d1-post-fail-${randomBytes(4).toString("hex")}`;
  await writePaneMarker(session1Name, built.home, marker1);
  const read1 = await readPaneThroughProxy({
    port: built.port,
    idSegment: built.sessionA.id,
    expect: marker1,
    timeoutMs: PROXY_READ_TIMEOUT_MS,
  });
  console.log(
    `second-start-rollback (d1): session 1 answerable after the failed second start — found=${read1.text.includes(marker1)}`,
  );
  if (!read1.text.includes(marker1)) {
    violations.push(
      `second-start-rollback (d1): session 1 did not echo marker "${marker1}" through the proxy after the failed second start`,
    );
  }

  // 5. card.nextSessionOrdinal ADVANCED despite the failure — the consumed ordinal is not
  // reclaimed.
  const ordinalAfter = persistedAfterFail?.nextSessionOrdinal ?? ordinalBefore;
  console.log(
    `second-start-rollback (d1): card.nextSessionOrdinal before=${ordinalBefore} after=${ordinalAfter}`,
  );
  if (ordinalAfter !== ordinalBefore + 1) {
    violations.push(
      `second-start-rollback (d1): card.nextSessionOrdinal expected to advance by exactly 1 despite the failure (before=${ordinalBefore}), got ${ordinalAfter}`,
    );
  }

  // 6. no leaked artifacts: only session 1's own worktree plus the deliberately-planted scratch
  // one, and no NEW worktree from the failed saga.
  const registered = await gitWorktreeListRegistered(built.repoPath);
  const mainWorktree = realpathSync(built.repoPath);
  const session1Wt = existsSync(built.session1WorktreePath)
    ? realpathSync(built.session1WorktreePath)
    : built.session1WorktreePath;
  const scratchWt = existsSync(collisionWtPath)
    ? realpathSync(collisionWtPath)
    : collisionWtPath;
  const nonMain = [...registered].filter((p) => p !== mainWorktree);
  console.log(
    `second-start-rollback (d1): git worktree list --porcelain (excluding main) = ${JSON.stringify(nonMain)}`,
  );
  const unexpected = nonMain.filter((p) => p !== session1Wt && p !== scratchWt);
  if (unexpected.length > 0) {
    violations.push(
      `second-start-rollback (d1): unexpected worktree(s) leaked by the failed saga: ${JSON.stringify(unexpected)}`,
    );
  }
  if (!registered.has(session1Wt)) {
    violations.push(
      `second-start-rollback (d1): session 1's own worktree went missing: ${built.session1WorktreePath}`,
    );
  }
  if (!registered.has(scratchWt)) {
    violations.push(
      `second-start-rollback (d1): the deliberately-planted scratch worktree went missing: ${collisionWtPath}`,
    );
  }

  // 7. Retry reproduces the intent: after removing the planted collision, POST again with
  // newSession:true and assert it now succeeds on a FRESH ordinal (`<identifier>-3`) — the
  // consumed-but-failed `<identifier>-2` ordinal is never reclaimed.
  await worktreeRemove(built.repoPath, collisionWtPath);
  console.log(
    `second-start-rollback (d1): removed the planted collision worktree ${collisionWtPath}`,
  );

  const { status: retryStatus, body: retryBody } = await startSecondSession(
    built,
    { newSession: true },
  );
  console.log(
    `second-start-rollback (d1): retry POST /start {newSession:true} -> ${retryStatus}`,
  );
  if (retryStatus !== 202) {
    violations.push(
      `second-start-rollback (d1): retry POST /start returned ${retryStatus}, expected 202 (body=${JSON.stringify(retryBody)})`,
    );
    return violations;
  }

  const { card: retryCard, timedOut: retryTimedOut } = await waitForSagaSettled(
    built,
    { timeoutMs: SECOND_SESSION_SAGA_TIMEOUT_MS },
  );
  if (retryTimedOut) {
    violations.push(
      `second-start-rollback (d1): retry saga did not settle within ${SECOND_SESSION_SAGA_TIMEOUT_MS}ms (last observed card=${JSON.stringify(retryCard)})`,
    );
    return violations;
  }
  if (retryCard?.startError != null) {
    violations.push(
      `second-start-rollback (d1): retry recorded a startError instead of succeeding: ${JSON.stringify(retryCard.startError)}`,
    );
    return violations;
  }

  const retryPersisted = readCard(built.dbPath, built.cardId);
  const retrySessions = retryPersisted?.sessions ?? [];
  console.log(
    `second-start-rollback (d1): persisted card.sessions after retry = ${JSON.stringify(retrySessions.map((s) => ({ id: s.id, tmuxSession: s.tmuxSession, branch: s.branch })))}`,
  );
  if (retrySessions.length !== 2) {
    violations.push(
      `second-start-rollback (d1): retry left ${retrySessions.length} session records, expected exactly 2`,
    );
  }
  const expectedRetryTmux = `dsp-${built.identifier}-3`;
  const retryLive = await tmuxListSessionNames();
  console.log(
    `second-start-rollback (d1): tmux list-sessions after retry = ${JSON.stringify(retryLive)}`,
  );
  if (!retryLive.includes(expectedRetryTmux)) {
    violations.push(
      `second-start-rollback (d1): retry's session expected EXACT tmux name ${expectedRetryTmux} (ordinal 3 — ordinal 2's failed attempt must not be reclaimed), not found in list-sessions: ${JSON.stringify(retryLive)}`,
    );
  }
  if (!retryLive.includes(session1Name)) {
    violations.push(
      `second-start-rollback (d1): session 1's EXACT tmux name ${session1Name} not found in list-sessions after the retry: ${JSON.stringify(retryLive)}`,
    );
  }

  // 8. wire shape: exactly one StartError-typed field on Card, none on Session.
  violations.push(...checkStartErrorWireShape("d1"));

  return violations;
}

/** POST `/api/cards/:id/session {sessionId}` — the real session-switch route. */
async function switchActiveSession(built, sessionId) {
  const res = await fetch(
    `http://127.0.0.1:${built.port}/api/cards/${built.cardId}/session`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId }),
    },
  );
  return res.status;
}

/** POST `/api/cards/:id/terminal` — the real ensure-ttyd-for-the-active-session route. */
async function ensureTerminalRoute(built) {
  const res = await fetch(
    `http://127.0.0.1:${built.port}/api/cards/${built.cardId}/terminal`,
    { method: "POST" },
  );
  return res.status;
}

/**
 * Poll {@link readPaneThroughProxy} until the WS upgrade actually opens (`resolveLiveTtydPort`
 * resolves once `ensureTtyd`'s spawn has landed), never a fixed sleep — `ensureTerminalRoute` above
 * returns 202 the instant the route is accepted, well before the ttyd child is actually listening.
 */
async function waitForProxyReady(built, idSegment, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = { opened: false, text: "", closeCode: null };
  while (Date.now() < deadline) {
    last = await readPaneThroughProxy({
      port: built.port,
      idSegment,
      expect: undefined,
      timeoutMs: 1000,
    });
    if (last.opened) return last;
    await sleep(200);
  }
  return last;
}

/**
 * Bring one session's real terminal up exactly as the UI does when a user opens its panel:
 * switch the card's active pointer to it, POST the ensure-terminal route, then poll the proxy
 * until the WS upgrade actually opens. Session 2's ttyd is never spawned by the start saga itself
 * ({@link ensureTerminal} in product code is reached only via this route or Resume), so this must
 * run before any pre-restart answerability baseline is meaningful.
 */
async function ensureSessionTerminalReady(built, sessionId) {
  const switchStatus = await switchActiveSession(built, sessionId);
  if (switchStatus !== 202) {
    return { ok: false, reason: `switch active session -> ${switchStatus}` };
  }
  const ensureStatus = await ensureTerminalRoute(built);
  if (ensureStatus !== 202) {
    return { ok: false, reason: `POST /terminal -> ${ensureStatus}` };
  }
  const ready = await waitForProxyReady(
    built,
    sessionId,
    PROXY_READ_TIMEOUT_MS,
  );
  if (!ready.opened) {
    return {
      ok: false,
      reason: `proxy WS never opened for session ${sessionId} within ${PROXY_READ_TIMEOUT_MS}ms`,
    };
  }
  return { ok: true };
}

/**
 * Poll {@link fetchFixtureCard} until a RESTART's saga has settled on a FAILURE specifically
 * (`provisioningStep` null AND `startError != null`) — deliberately NOT {@link waitForSagaSettled},
 * whose `(card.sessionCount ?? 1) >= 2` half of its OR would already read true from session 2's
 * PRIOR successful creation before this restart's saga has even been scheduled by the event loop,
 * making that helper settle vacuously fast on this direction's own fixture shape.
 */
async function waitForRestartFailureSettled(built, { timeoutMs }) {
  const deadline = Date.now() + timeoutMs;
  let card;
  while (Date.now() < deadline) {
    card = await fetchFixtureCard(built);
    if (
      card != null &&
      card.provisioningStep == null &&
      card.startError != null
    ) {
      return { card, timedOut: false };
    }
    await sleep(POLL_INTERVAL_MS);
  }
  return { card, timedOut: true };
}

/**
 * Direction 2 (Plan 94-07 Task 1/2, criterion C3, START-02): a failing FIRST-session ROLLBACK
 * must not kill the suffixed sibling — this is the direction with no precedent anywhere in this
 * repo, and the reason the check exists (94-VALIDATION.md C3, `steps.ts:387`).
 * @remarks The forced failure is {@link writeExitingStubClaudeBinary}, and the wait after it is
 * deliberately generous (`RESTART_REPL_TIMEOUT_SETTLE_MS`, comfortably past `steps.ts`'s own 30s
 * `READINESS_TIMEOUT_MS`) rather than fast, because of a live-verified finding this direction's
 * first two drafts ran into: once session 1's exact tmux name is absent while the suffixed sibling
 * is alive, EVERY bare (non-`=`) `-t`-targeted tmux command `steps.ts` issues — not just
 * `has-session`/`kill-session` (94-RESEARCH.md Pitfall 1) but also `capturePane`, and (confirmed by
 * direct reproduction against this machine's tmux 3.6a) `paste-buffer` and `send-keys` — silently
 * PREFIX-MATCHES onto the sibling and reports SUCCESS rather than throwing. That means
 * `sendKickoff`'s own tmux calls can never surface the absence as an exception: a kill timed to
 * land mid-`sendKickoff` (this direction's first two drafts, racing `tmux list-sessions` detection
 * and a short-sleep exiting stub respectively) either loses the race entirely or produces a saga
 * that silently "succeeds" by misdelivering session 1's kickoff into session 2's pane — never
 * reaching `startClaude.undo` at all. The ONE step immune to this silent-success trap is
 * `awaitReplReady`'s own hardcoded wall-clock deadline, which fires regardless of what
 * `capturePane` returns; killing the session as early as possible (this stub exits immediately
 * on launch) maximizes the absence window across that whole 30s poll, so it reliably exhausts the
 * deadline and throws a genuine `StartStepError("starting claude", ..., "repl-timeout")` —
 * `currentStep` is `startClaude` itself at that point, so its `undo` runs directly. Full account,
 * including the independent finding that the real background 3-strike detector
 * (`markers/watcher.ts`) promotes session 2 to active during this wait (harmless to this check's
 * own assertions, which never read `activeSessionId`/`sessionLost`), in 94-07-SUMMARY.md
 * Deviations. Direction 1's branch-collision vehicle fails BEFORE `startClaude` runs —
 * `ctx.tmuxSessionCreated` stays `false` and no kill is even attempted — so it structurally cannot
 * exercise this defect; that is why this direction needs its own vehicle.
 */
async function checkSecondStartRollbackDirection2(built) {
  const violations = [];
  const session1Name = built.tmux.a;
  const session2Name = `dsp-${built.identifier}-2`;

  const { status, body } = await startSecondSession(built, {
    newSession: true,
  });
  console.log(
    `second-start-rollback (d2): POST /start {newSession:true} (session 2 setup) -> ${status}`,
  );
  if (status !== 202) {
    violations.push(
      `second-start-rollback (d2): session 2 setup POST /start returned ${status}, expected 202 (body=${JSON.stringify(body)})`,
    );
    return violations;
  }
  const { card, timedOut } = await waitForSagaSettled(built, {
    timeoutMs: SECOND_SESSION_SAGA_TIMEOUT_MS,
  });
  if (timedOut) {
    violations.push(
      `second-start-rollback (d2): session 2 setup saga did not settle within ${SECOND_SESSION_SAGA_TIMEOUT_MS}ms (last observed card=${JSON.stringify(card)})`,
    );
    return violations;
  }
  if (card?.startError != null) {
    violations.push(
      `second-start-rollback (d2): session 2 setup recorded a startError: ${JSON.stringify(card.startError)}`,
    );
    return violations;
  }
  const session2Id = (card?.sessionSummaries ?? [])
    .map((s) => s.id)
    .find((id) => id !== built.sessionA.id);
  if (!session2Id) {
    violations.push(
      `second-start-rollback (d2): could not resolve session 2's id from sessionSummaries=${JSON.stringify(card?.sessionSummaries)}`,
    );
    return violations;
  }
  console.log(
    `second-start-rollback (d2): session 1 = ${session1Name} (${built.sessionA.id}), session 2 = ${session2Name} (${session2Id})`,
  );

  const liveSetup = await tmuxListSessionNames();
  if (!liveSetup.includes(session2Name)) {
    violations.push(
      `second-start-rollback (d2): session 2's EXACT tmux name ${session2Name} not found right after creation: ${JSON.stringify(liveSetup)}`,
    );
    return violations;
  }

  const readyResult = await ensureSessionTerminalReady(built, session2Id);
  if (!readyResult.ok) {
    violations.push(
      `second-start-rollback (d2): could not bring session 2's terminal up before the forced failure — ${readyResult.reason}`,
    );
    return violations;
  }
  const markerBefore = `d2-pre-fail-${randomBytes(4).toString("hex")}`;
  await writePaneMarker(session2Name, built.home, markerBefore);
  const readBefore = await readPaneThroughProxy({
    port: built.port,
    idSegment: session2Id,
    expect: markerBefore,
    timeoutMs: PROXY_READ_TIMEOUT_MS,
  });
  console.log(
    `second-start-rollback (d2): session 2 answerable BEFORE session 1's restart — found=${readBefore.text.includes(markerBefore)}`,
  );
  if (!readBefore.text.includes(markerBefore)) {
    violations.push(
      `second-start-rollback (d2): session 2 did not echo marker "${markerBefore}" through the proxy BEFORE session 1's restart — the fixture itself is not answerable, so no later claim about it is meaningful`,
    );
    return violations;
  }

  // Refocus session 1 (not load-bearing — a plain restart always targets card.identifier
  // regardless of the active pointer — but mirrors the realistic flow of restarting what you're
  // looking at).
  await switchActiveSession(built, built.sessionA.id);

  await tmuxKillSessionExact(session1Name);
  console.log(
    `second-start-rollback (d2): killed session 1's tmux session ${session1Name} to force a real restart (not a reattach)`,
  );

  // THE FORCED-FAILURE VEHICLE: swap the stub `claude` in place for a variant that exits
  // IMMEDIATELY. `startClaude.run` recreates session 1's tmux session (ctx.tmuxSessionCreated
  // becomes true), the exiting stub then terminates it within tens of milliseconds (tmux's
  // default remain-on-exit=off), maximizing the window in which the exact name is absent across
  // the whole 30s readiness poll. See this function's own doc comment for why only
  // `awaitReplReady`'s hardcoded deadline — not any of `sendKickoff`'s own tmux calls — can turn
  // that absence into a genuine thrown failure.
  writeExitingStubClaudeBinary(built.home);
  console.log(
    `second-start-rollback (d2): swapped the stub claude for an exit-immediately variant`,
  );

  const { status: restartStatus, body: restartBody } = await startSecondSession(
    built,
    { newSession: false },
  );
  console.log(
    `second-start-rollback (d2): restart POST /start {newSession:false} -> ${restartStatus}`,
  );
  if (restartStatus !== 202) {
    violations.push(
      `second-start-rollback (d2): restart POST /start returned ${restartStatus}, expected 202 (body=${JSON.stringify(restartBody)})`,
    );
    return violations;
  }

  console.log(
    `second-start-rollback (d2): waiting up to ${RESTART_REPL_TIMEOUT_SETTLE_MS}ms for awaitReplReady's own 30s deadline to fire and the saga to compensate…`,
  );
  const { card: afterCard, timedOut: afterTimedOut } =
    await waitForRestartFailureSettled(built, {
      timeoutMs: RESTART_REPL_TIMEOUT_SETTLE_MS,
    });
  if (afterTimedOut) {
    violations.push(
      `second-start-rollback (d2): restart saga did not settle on a failure within ${RESTART_REPL_TIMEOUT_SETTLE_MS}ms (last observed card=${JSON.stringify(afterCard)})`,
    );
    return violations;
  }

  // 1. the restart failed with a startError carrying no newSession field.
  console.log(
    `second-start-rollback (d2): restart startError = ${JSON.stringify(afterCard?.startError)}`,
  );
  if (afterCard?.startError == null) {
    violations.push(
      `second-start-rollback (d2): expected the restart to fail with a startError (forced failure), got none — card=${JSON.stringify(afterCard)}`,
    );
    return violations;
  }
  if ("newSession" in afterCard.startError) {
    violations.push(
      `second-start-rollback (d2): restart's startError carries a "newSession" field (${JSON.stringify(afterCard.startError.newSession)}) — a plain restart is not a "start another session" attempt`,
    );
  }

  // 2. THE PREFIX-KILL GUARD: session 2's EXACT tmux name must survive session 1's rolled-back
  // restart, by exact-string comparison — never a count, never startsWith.
  const liveAfter = await tmuxListSessionNames();
  console.log(
    `second-start-rollback (d2): tmux list-sessions after the rolled-back restart = ${JSON.stringify(liveAfter)}`,
  );
  if (!liveAfter.includes(session2Name)) {
    violations.push(
      `second-start-rollback (d2): session 2's EXACT tmux name ${session2Name} MISSING after session 1's rolled-back restart — the tmux 3.6a prefix-match trap: an unprefixed kill-session target absent its own exact match resolves onto the longer sibling instead. live=${JSON.stringify(liveAfter)}`,
    );
  }

  const markerAfter = `d2-post-fail-${randomBytes(4).toString("hex")}`;
  await writePaneMarker(session2Name, built.home, markerAfter);
  const readAfter = await readPaneThroughProxy({
    port: built.port,
    idSegment: session2Id,
    expect: markerAfter,
    timeoutMs: PROXY_READ_TIMEOUT_MS,
  });
  console.log(
    `second-start-rollback (d2): session 2 answerable AFTER the rolled-back restart — found=${readAfter.text.includes(markerAfter)}`,
  );
  if (!readAfter.text.includes(markerAfter)) {
    violations.push(
      `second-start-rollback (d2): session 2 did not echo marker "${markerAfter}" through the proxy after session 1's rolled-back restart — its tmux name surviving is not the same as the session still ANSWERING`,
    );
  }

  // 3. the card still holds session 2's record with its own tmuxSession/branch/workspacePath
  // intact.
  const persisted = readCard(built.dbPath, built.cardId);
  const persistedSessions = persisted?.sessions ?? [];
  console.log(
    `second-start-rollback (d2): persisted card.sessions after the rolled-back restart = ${JSON.stringify(persistedSessions.map((s) => ({ id: s.id, tmuxSession: s.tmuxSession, branch: s.branch, workspacePath: s.workspacePath })))}`,
  );
  if (persistedSessions.length !== 2) {
    violations.push(
      `second-start-rollback (d2): persisted card.sessions has ${persistedSessions.length} records, expected 2 (session 1's failed restart must not add or remove a record)`,
    );
  }
  const session2Record = persistedSessions.find((s) => s.id === session2Id);
  if (!session2Record) {
    violations.push(
      `second-start-rollback (d2): session 2's own record (${session2Id}) is missing from persisted sessions after session 1's rolled-back restart`,
    );
  } else {
    if (session2Record.tmuxSession !== session2Name) {
      violations.push(
        `second-start-rollback (d2): session 2's persisted tmuxSession expected "${session2Name}", got "${session2Record.tmuxSession}"`,
      );
    }
    if (session2Record.branch !== `${built.identifier}-2`) {
      violations.push(
        `second-start-rollback (d2): session 2's persisted branch expected "${built.identifier}-2", got "${session2Record.branch}"`,
      );
    }
    const expectedSession2Workspace = join(
      built.home,
      "workspaces",
      `${built.identifier}-2`,
    );
    if (session2Record.workspacePath !== expectedSession2Workspace) {
      violations.push(
        `second-start-rollback (d2): session 2's persisted workspacePath expected "${expectedSession2Workspace}", got "${session2Record.workspacePath}"`,
      );
    }
  }

  violations.push(...checkStartErrorWireShape("d2"));

  return violations;
}

/**
 * `--check second-start-rollback` (Plan 94-07, criterion C3, START-02): both directions the
 * criterion names, each its own fresh {@link SECOND_SESSION_FIXTURE} instance — a failing SECOND
 * start must not disturb session 1 (Direction 1, proves Break A: removing the rollback call),
 * and a failing FIRST-session rollback must not kill the suffixed sibling (Direction 2, proves
 * Break B: the tmux prefix-kill, this phase's headline defect).
 */
async function checkSecondStartRollback() {
  const violations = [];
  violations.push(
    ...(await withFixture(
      "second-start-rollback-d1",
      checkSecondStartRollbackDirection1,
      SECOND_SESSION_FIXTURE,
    )),
  );
  violations.push(
    ...(await withFixture(
      "second-start-rollback-d2",
      checkSecondStartRollbackDirection2,
      SECOND_SESSION_FIXTURE,
    )),
  );
  return violations;
}

const CHECKS = {
  safety: () => withFixture("safety", checkSafety),
  "hook-attribution": () =>
    withFixture("hook-attribution", checkHookAttribution),
  liveness: checkLiveness,
  reconcile: checkReconcile,
  attention: () => withFixture("attention", checkAttention),
  "attention-dead-sibling": () =>
    withFixture("attention-dead-sibling", checkAttentionDeadSibling),
  "single-session": () =>
    withFixture("single-session", checkSingleSession, SINGLE_SESSION_FIXTURE),
  "proxy-addressing": () =>
    withFixture("proxy-addressing", checkProxyAddressing),
  "orphan-sweep": () => withFixture("orphan-sweep", checkOrphanSweep),
  "switch-sockets": () => withFixture("switch-sockets", checkSwitchSockets),
  "switch-atomicity": () =>
    withFixture("switch-atomicity", checkSwitchAtomicity),
  "cleanup-fixture": () =>
    withFixture("cleanup-fixture", checkCleanupFixture, WORKTREE_FIXTURE),
  "cleanup-isolation": checkCleanupIsolation,
  "cleanup-refusal": checkCleanupRefusal,
  "cleanup-branches": checkCleanupBranches,
  "cleanup-schedule-restart": checkCleanupScheduleRestart,
  "second-session-fixture": () =>
    withFixture(
      "second-session-fixture",
      checkSecondSessionFixture,
      SECOND_SESSION_FIXTURE,
    ),
  "second-session-isolation": () =>
    withFixture(
      "second-session-isolation",
      checkSecondSessionIsolation,
      SECOND_SESSION_FIXTURE,
    ),
  "naming-consistency": () =>
    withFixture(
      "naming-consistency",
      checkNamingConsistency,
      SECOND_SESSION_FIXTURE,
    ),
  "reserve-coalesce": () =>
    withFixture(
      "reserve-coalesce",
      checkReserveCoalesce,
      SECOND_SESSION_FIXTURE,
    ),
  "second-start-rollback": checkSecondStartRollback,
};

/**
 * Run one named check end to end: the WR-08 safety-envelope re-assert, the check's own fixture
 * lifecycle(s) via {@link withFixture}, the real board.db before/after comparison. A thrown error
 * anywhere inside a check is folded into `violations` by that check's own `withFixture` call, so
 * this function's only remaining failure mode is an unknown check name.
 */
async function runCheck(name) {
  await assertNoLiveService();
  assertBuilt();

  const realBefore = statRealBoardDb();
  console.log(`LIVE ${realBefore.path} BEFORE: ${fmtStat(realBefore)}`);

  const checkFn = CHECKS[name];
  let violations;
  if (!checkFn) {
    violations = [`unknown check "${name}"`];
  } else {
    try {
      violations = await checkFn();
    } catch (err) {
      violations = [
        `run failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
      ];
    }
  }

  const realAfter = statRealBoardDb();
  console.log(`LIVE ${realAfter.path} AFTER: ${fmtStat(realAfter)}`);
  if (
    realBefore.exists !== realAfter.exists ||
    realBefore.mtimeMs !== realAfter.mtimeMs ||
    realBefore.size !== realAfter.size
  ) {
    violations.push(
      `the real ${realAfter.path} changed during this run — before=${fmtStat(realBefore)} after=${fmtStat(realAfter)}`,
    );
  }

  return violations;
}

async function main() {
  const args = process.argv.slice(2);
  const flagIndex = args.indexOf("--check");
  const name = flagIndex >= 0 ? args[flagIndex + 1] : undefined;
  if (!name) {
    console.error(
      `usage: node scripts/session-liveness-v3.mjs --check <${[...Object.keys(CHECKS), "all"].join("|")}>`,
    );
    process.exit(1);
  }
  const names = name === "all" ? Object.keys(CHECKS) : [name];
  if (name !== "all" && !CHECKS[name]) {
    console.error(
      `unknown check "${name}" — valid: ${Object.keys(CHECKS).join(", ")}, all`,
    );
    process.exit(1);
  }

  let allViolations = [];
  for (const n of names) {
    console.log(`\n=== running check: ${n} ===`);
    const violations = await runCheck(n);
    if (violations.length > 0) {
      console.log(`FAIL (${n}): ${violations.length} violation(s)`);
      for (const v of violations) console.log(`  ${v}`);
    } else {
      console.log(`PASS (${n})`);
    }
    allViolations = allViolations.concat(violations);
  }

  if (allViolations.length === 0) {
    console.log(`\nPASS: ${names.join(", ")}`);
    process.exit(0);
  }
  console.log(
    `\nFAIL: ${allViolations.length} violation(s) across ${names.join(", ")}`,
  );
  process.exit(1);
}

main().catch((err) => {
  console.error(`session-liveness-v3 failed: ${err.stack ?? err.message}`);
  process.exit(1);
});
