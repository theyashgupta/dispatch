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
 *   node scripts/session-liveness-v3.mjs --check inherit-ancestry  Phase 95 criterion 1
 *                                                                   (MULTI-02): a REAL inherited
 *                                                                   start's child branch is proven
 *                                                                   to descend from the parent's
 *                                                                   OWN named commit sha (never
 *                                                                   just "is-ancestor exited 0",
 *                                                                   which a base-cut child would
 *                                                                   also satisfy if the fixture's
 *                                                                   parent carried no commit of its
 *                                                                   own), the fetch-skip is proven
 *                                                                   by a zero-warning board, and the
 *                                                                   child's own tmux pane is proven
 *                                                                   to have received the "Building
 *                                                                   on a previous session" kickoff
 *                                                                   heading
 *   node scripts/session-liveness-v3.mjs --check inherit-parent-intact
 *                                                                   Phase 95 criterion 2 (MULTI-02):
 *                                                                   the parent's worktree HEAD and
 *                                                                   porcelain are byte-identical
 *                                                                   before/after a REAL inherited
 *                                                                   child starts, its planted
 *                                                                   uncommitted file never crosses
 *                                                                   into the child, and the parent's
 *                                                                   EXACT tmux session still answers
 *                                                                   a real typed round trip
 *   node scripts/session-liveness-v3.mjs --check inherit-parentage Phase 95 criterion 3
 *                                                                   (MULTI-02/UI-03): the parent's
 *                                                                   id is PERSISTED on the child's
 *                                                                   record, the wire reports it as a
 *                                                                   positional display ordinal, a
 *                                                                   session that was never inherited
 *                                                                   carries NO parentOrdinal key at
 *                                                                   all (Object.hasOwn, never a
 *                                                                   nullish test), and a child whose
 *                                                                   parent record has been removed
 *                                                                   degrades to silence on the wire
 *                                                                   while KEEPING its recorded
 *                                                                   builtFrom — asserted on a THREE
 *                                                                   session fixture so the removal
 *                                                                   cannot drop the card below
 *                                                                   redactCard's own N>=2 gate
 *   node scripts/session-liveness-v3.mjs --check inherit-depth     Phase 95 criterion 4
 *                                                                   (MULTI-02/UI-03, decision D-C):
 *                                                                   a REAL 1 -> 2 -> 3 chain is
 *                                                                   built by two separate inherited
 *                                                                   starts, and session 3 is proven
 *                                                                   to record SESSION 2 — the
 *                                                                   session the user actually built
 *                                                                   from — never session 1 and never
 *                                                                   nothing, at the record, at the
 *                                                                   wire and in git at BOTH hops,
 *                                                                   with a source census that fails
 *                                                                   if anyone ever starts walking
 *                                                                   the chain
 *   node scripts/session-liveness-v3.mjs --check reinstall-session PERSIST-04: a real dsp tmux plus
 *                                                                   ttyd session survives a
 *                                                                   simulated reinstall (a stale
 *                                                                   plist healed) and a real
 *                                                                   backend restart, held by the
 *                                                                   SAME ttyd pid, with the
 *                                                                   board's own GET /api/board wire
 *                                                                   as the witness. Two break
 *                                                                   modes, set via
 *                                                                   DISPATCH_REINSTALL_SESSION_BREAK:
 *                                                                   `kill-ttyd` (breaks the
 *                                                                   adoption assertions) and
 *                                                                   `skip-heal` (breaks the plist
 *                                                                   assertion), observed
 *                                                                   failing-direction evidence for
 *                                                                   both is pending, plan 97-06
 *                                                                   fills it in
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
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir, homedir } from "node:os";
import { basename, delimiter, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
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
 * `KEEP-02` row 9's own source of truth for the board's shared column set — loaded from
 * `dist/shared/` (never re-derived by hand) so `MOVABLE_COLUMNS = [...COLUMNS, "inbox"]` is
 * computed from the product's own column list at runtime rather than a hardcoded 7-entry literal.
 * Same dynamic-`import()`-after-{@link assertBuilt} discipline as {@link DIST_GIT_ADAPTER} /
 * {@link DIST_WORKSPACE_PATHS} above, for the same staleness reason.
 * @remarks Row 9 does NOT similarly import `isManualMoveAllowed` / `blocksAgentDoneManualEntry` /
 * `blocksTodoToInProgressManualMove` (`column-transitions.ts`) or `isDemoteEligible`
 * (`demote-eligibility.ts`) to compute its own EXPECTED outcome — see
 * {@link isAgentDoneManualTargetBlocked}'s own JSDoc for why importing the same function the
 * product enforces with would make this row structurally blind to the exact break
 * `96-06-PLAN.md` specifies.
 */
const DIST_TYPES = join(REPO_ROOT, "dist", "shared", "types.js");

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

const PARITY_SANDBOX_PORT = 47867;

/**
 * A real ticket identifier the actual start saga will consume, following
 * {@link SECOND_SESSION_IDENTIFIER}'s own PID-suffixed idiom — doubles as {@link PARITY_FIXTURE}'s
 * tmux namespace (`dsp-<identifier>`) so a leaked sibling from a prior failed run is still caught
 * by {@link assertPreflightClean}'s generic prefix filter with no change to that function.
 */
const PARITY_IDENTIFIER = `ZZ96${process.pid}-1`;

/**
 * `KEEP-02`'s single merged fixture (96-CONTEXT.md's "one merged profile, not three
 * sub-profiles" decision): the one profile carrying all three properties no prior profile ever
 * combined — `sessionKeys: ["a"]` (N=1: {@link SINGLE_SESSION_FIXTURE}'s own property;
 * `redactCard` emits `sessionCount`/`sessionSummaries` only at >= 2, so N=1 is a structurally
 * different subject, never a two-session fixture with one participant idle), `realSaga: true`
 * ({@link SECOND_SESSION_FIXTURE}'s property — a genuine `POST /start` through the real
 * orchestrator, needed for `KEEP-02` rows 1/2/8), and `worktrees: true` ({@link WORKTREE_FIXTURE}'s
 * property — a real, git-registered worktree, needed for rows 10/11's teardown).
 *
 * The card is seeded WITH ZERO SESSIONS, not with session 1 pre-built the way
 * {@link standUpRealSagaFixture}'s existing branch pre-builds {@link SECOND_SESSION_FIXTURE}'s own
 * session 1: {@link standUpRealSagaFixture} branches on `built.worktrees` (true for this profile
 * only) to seed a sessionless card and drive session 1 into existence through one real
 * `POST /cards/:id/start` (no `newSession`) — the exact request a card's very first "Start" click
 * sends. This fixture's own stand-up therefore IS row 1's (start) exercise, unavoidably run before
 * any check against it can proceed, rather than a separate row a later check has to remember to
 * drive.
 *
 * **The two flags compose without any conflict, and no double-creation is possible.** `realSaga`
 * and `worktrees` were never set together before this profile, but they need no new arbitration:
 * `standUpFixture` branches on `realSaga` FIRST and returns immediately into
 * {@link standUpRealSagaFixture}, which never once reads `built.worktrees` for the ORIGINAL
 * (non-`worktrees`) branch it keeps unchanged for {@link SECOND_SESSION_FIXTURE} — so setting
 * `worktrees: true` cannot layer a second, redundant worktree-creation path onto the real-saga
 * path; it can only SELECT the alternate `worktrees`-branch this profile introduces. Inside that
 * branch, the ONLY worktree creation is the real saga's own "creating worktrees" step
 * (`steps.ts`) — there is no `seedFixtureRepo`-plus-manual-`worktreeAddNewBranch` step running
 * ahead of it the way {@link standUpFixture}'s non-real-saga `worktrees` branch has, so nothing
 * competes with the real saga to create the SAME worktree twice. Teardown is symmetric:
 * {@link tearDownFixture} branches on `realSaga` first and returns into
 * {@link tearDownRealSagaFixture}, which ALREADY discovers and removes every worktree via
 * `git worktree list --porcelain` (never a hardcoded path list) regardless of `built.worktrees` —
 * that discovery-based removal is what {@link SECOND_SESSION_FIXTURE}'s own session-2 worktree
 * already relies on, so this profile needs no teardown change either. Every existing profile's own
 * stand-up/tear-down code path is therefore untouched byte-for-byte; this profile only adds ONE
 * new conditional branch inside {@link standUpRealSagaFixture} that nothing else can reach.
 * @remarks `sessionKeys`' LENGTH stays load-bearing here exactly as it is on every other profile
 * (this file's own header on {@link SESSION_FIELD_BY_KEY}): the default single-key array creates
 * ONLY session 1 through the real first-start saga described above, but
 * {@link standUpParityFixtureSession1} drives one additional real `POST /start {newSession:true}`
 * per key beyond the first, so a break that widens `sessionKeys` to `["a", "b"]` genuinely
 * produces a real two-session card — never a documentary flag with no runtime effect — which is
 * what makes this profile's own N=1 claim break-provable rather than merely asserted.
 */
const PARITY_FIXTURE = {
  port: PARITY_SANDBOX_PORT,
  tmuxPrefix: `dsp-${PARITY_IDENTIFIER}`,
  sessionKeys: ["a"],
  identifier: PARITY_IDENTIFIER,
  realSaga: true,
  worktrees: true,
};

/**
 * `--check hook-token-attribution` (Phase 96 plan 11, F-96-A): identical to {@link PARITY_FIXTURE}
 * except for `sessionKeys`, whose second entry drives {@link standUpParityFixtureSession1}'s own
 * "one more real `POST /start {newSession:true}`" loop — the only PARITY-shaped profile this
 * milestone stands up with a live sibling AND a hooks-capable stub from boot.
 * {@link SECOND_SESSION_FIXTURE} cannot substitute: its stand-up plants the below-floor stub
 * (`writeStubClaudeBinary`), and `getHooksRuntime()`'s capability flag is probed once at boot and
 * cached for the server's lifetime, so a second session created on that fixture never reaches
 * `startClaude`'s hooks-capable branch at all — the very branch F-96-A lives in.
 */
const HOOK_ATTRIBUTION_FIXTURE = {
  port: PARITY_SANDBOX_PORT,
  tmuxPrefix: `dsp-${PARITY_IDENTIFIER}`,
  sessionKeys: ["a", "b"],
  identifier: PARITY_IDENTIFIER,
  realSaga: true,
  worktrees: true,
};

const GROUP_SESSION_SANDBOX_PORT = 47868;

const GROUP_SESSION_TMUX_PREFIX = `dsp96g-${process.pid}-`;

/**
 * The `KEEP-03` subject: a group PARENT card owning two or more REAL sessions (`sessionKeys`
 * length >= 2, the same load-bearing-length convention every profile shares) that ALSO owns two
 * member cards — the shape no existing profile comes close to (none seeds a group card at all,
 * `96-RESEARCH.md` `## 3`). A parent owning exactly one session would prove nothing about
 * `KEEP-03`: the requirement's own wording is "a group card owning N sessions must not collide
 * with the existing members concept," and a one-session group card behaved this way before this
 * milestone too (`96-RESEARCH.md` Pitfall 3) — only a genuinely multi-session parent forces the
 * multi-session shape and the members concept to actually coexist.
 *
 * `group: true` is the flag {@link standUpFixture} branches on to reach
 * {@link standUpGroupSessionFixture} instead of the generic two-session body every other non-
 * real-saga profile above shares; no other profile sets it, so their own paths through
 * {@link standUpFixture} are unchanged. The parent is seeded in `in_progress` (matching
 * {@link TWO_SESSION_FIXTURE}/{@link WORKTREE_FIXTURE}'s own precedent for a card with real,
 * already-live sessions) rather than `todo`: `96-RESEARCH.md`'s Phase 90 `in_progress` pitfall
 * (`reconcileSessions`'s dead-tmux marking producing a false mismatch) is an ORDERING hazard —
 * real tmux/ttyd must exist before the fixture's own final boot runs `reconcileSessions` — and
 * {@link standUpGroupSessionFixture} follows the exact same tmux-then-ttyd-then-boot ordering
 * {@link standUpFixture}'s own remarks document, so the pitfall does not recur here regardless of
 * column. The two member cards stay in `todo` (no sessions of their own), matching
 * `createGroupCard`'s own real-mint eligibility shape for an ordinary member.
 * @remarks The member linkage is derived FROM the parent's own `memberIds`, not hardcoded
 * independently of it: {@link standUpGroupSessionFixture} loops over `parent.memberIds` to decide
 * which cards get seeded with `groupId` pointing at the parent, the same relationship the real
 * server's own `membersOf` (`board.store.ts:1144`, a `groupId === parentId` filter) depends on.
 * This is what makes Break 2 (dropping `memberIds` from the seeded parent) a REAL break: with an
 * empty `memberIds`, the loop seeds no `groupId`-linked member at all, so `membersOf` genuinely
 * returns zero — never a fixture that reports a healthy group over a link that was never real.
 */
const GROUP_SESSION_FIXTURE = {
  port: GROUP_SESSION_SANDBOX_PORT,
  tmuxPrefix: GROUP_SESSION_TMUX_PREFIX,
  sessionKeys: ["a", "b"],
  group: true,
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
 * exists is not guaranteed to kill session 1 specifically. `send-keys`/`capture-pane` need the
 * SAME exact-match protection but as pane-level targets require a TRAILING COLON (`=<name>:`) to
 * resolve at all — the colon-less form here reports "can't find pane" for those subcommands even
 * against a live session (Phase 96 plan 11, `checkSecondStartRollbackDirection3`).
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

/** Memoized `dist/shared/types.js` load — same discipline as {@link loadGitAdapter}. */
let typesModule = null;
async function loadTypes() {
  if (typesModule === null) {
    assertBuilt();
    typesModule = await import(DIST_TYPES);
  }
  return typesModule;
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
 * {@link writeStubClaudeBinary}'s own shape, with ONE byte-level difference: `--version` reports
 * `2.2.0`, ABOVE `hook-setup.ts`'s `HOOKS_FLOOR` (`[2, 1, 207]`) rather than below it. Every other
 * fixture's stub deliberately reports a below-floor version so its saga takes the simpler
 * hook-SILENT launch branch (`writeStubClaudeBinary`'s own doc comment) — {@link PARITY_FIXTURE}'s
 * session 1 is the one exception: `KEEP-02` rows 3-5 (marker routing, needs-input flip, flip-back)
 * exercise the REAL per-session hook-token channel `checkSingleSession` itself tests, which only
 * mints when `checkHooksCapability` resolves `capable: true`. Used ONLY by
 * {@link standUpParityFixtureSession1} — no other fixture profile reaches that function, so no
 * other check's stub shape is affected.
 */
function writeHooksCapableStubClaudeBinary(home) {
  const binDir = join(home, "bin");
  mkdirSync(binDir, { recursive: true });
  const claudePath = join(binDir, "claude");
  writeFileSync(
    claudePath,
    "#!/bin/sh\n" +
      'case " $* " in\n' +
      '  *" --version "*)\n' +
      '    echo "2.2.0 (Claude Code)"\n' +
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

/**
 * Plant a stub `gh` beside the stub `claude` in the SAME `bin/` directory
 * {@link writeStubClaudeBinary} already put on the sandbox server's `PATH`, so no `bootServer`
 * restart is needed to make it resolvable — `listPrsForBranch` spawns `gh` fresh on every probe
 * tick and resolves it through the child's `PATH` at spawn time, not at server boot.
 *
 * @remarks The stub answers `gh pr list --head <branch> …` with a set that is a DETERMINISTIC
 * FUNCTION OF THE BRANCH, which is the whole point: `ARTIFACT-01`'s regression broadcasts one
 * session's result onto its sibling, and a fixture where both sessions expect the SAME PR set
 * cannot tell correct attribution from a broadcast. The PR number is derived from the branch's
 * own suffix so session 1 and session 2 can never coincide.
 *
 * Failure injection for the per-session-backoff assertion is driven by a control FILE
 * (`gh-fail-branch` under the sandbox home) rather than by rewriting this script, so one branch
 * can be made to fail while the other keeps succeeding WITHOUT touching the binary the running
 * server has already resolved. An empty/absent file means every branch succeeds.
 */
function writeStubGhBinary(home) {
  const binDir = join(home, "bin");
  mkdirSync(binDir, { recursive: true });
  const ghPath = join(binDir, "gh");
  const failFile = join(home, "gh-fail-branch");
  writeFileSync(
    ghPath,
    "#!/bin/sh\n" +
      "branch=''\n" +
      "prev=''\n" +
      'for a in "$@"; do\n' +
      '  if [ "$prev" = "--head" ]; then branch="$a"; fi\n' +
      '  prev="$a"\n' +
      "done\n" +
      `if [ -f '${failFile}' ] && [ "$(cat '${failFile}')" = "$branch" ]; then\n` +
      "  echo 'gh pr list failed: stub-injected failure' >&2\n" +
      "  exit 1\n" +
      "fi\n" +
      'suffix=$(echo "$branch" | sed "s/.*-//")\n' +
      'case "$suffix" in\n' +
      '  ""|*[!0-9]*) num=101 ;;\n' +
      "  *) num=$((200 + suffix)) ;;\n" +
      "esac\n" +
      'printf \'[{"number":%s,"url":"https://example.invalid/pr/%s","title":"stub PR for %s","state":"OPEN","isDraft":false,"statusCheckRollup":[]}]\\n\' "$num" "$num" "$branch"\n',
    { mode: 0o755 },
  );
  return { binDir, ghPath, failFile };
}

/**
 * The PR number {@link writeStubGhBinary}'s stub answers for `branch`, recomputed here in JS so the
 * check's expectation is derived INDEPENDENTLY of the shell script rather than read back from it —
 * an expectation the fixture itself supplies is not an assertion.
 */
function expectedStubPrNumber(branch) {
  const suffix = branch.includes("-")
    ? branch.slice(branch.lastIndexOf("-") + 1)
    : "";
  return /^[0-9]+$/.test(suffix) ? 200 + Number(suffix) : 101;
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
 * @remarks (Plan 96-03) When `built.worktrees` is set ({@link PARITY_FIXTURE} only), this function
 * hands off entirely to {@link standUpParityFixtureSession1} instead of running the branch below —
 * see {@link PARITY_FIXTURE}'s own doc comment for why the two flags compose without conflict.
 * {@link SECOND_SESSION_FIXTURE} never sets `worktrees`, so its own path through this function is
 * byte-for-byte unchanged.
 */
async function standUpRealSagaFixture(built) {
  const warmup = bootServer(built.home);
  await waitForReady(built.port);
  await killAndWait(warmup.child);

  if (built.worktrees) {
    return standUpParityFixtureSession1(built);
  }

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

/**
 * {@link waitForSagaSettled}'s N=1 counterpart: polls until a FIRST start (no `newSession`) has
 * settled — `provisioningStep` clear, and either the flat `tmuxSession` mirror `completeStart`
 * projects onto the wire card has landed, or the saga recorded a `startError`. Written as its own
 * function rather than widening {@link waitForSagaSettled}: that function's settle predicate is
 * deliberately N>=2-shaped (`(card.sessionCount ?? 1) >= 2`), and a shared predicate accepting
 * either shape could mistake an N=1 settle for row 8/9's own N>=2 subject, or vice versa.
 */
async function waitForFirstStartSettled(built, { timeoutMs }) {
  const deadline = Date.now() + timeoutMs;
  let card;
  while (Date.now() < deadline) {
    card = await fetchFixtureCard(built);
    const settled =
      card != null &&
      card.provisioningStep == null &&
      (card.tmuxSession != null || card.startError != null);
    if (settled) return { card, timedOut: false };
    await sleep(POLL_INTERVAL_MS);
  }
  return { card, timedOut: true };
}

/**
 * Session-1 stand-up for {@link PARITY_FIXTURE} ONLY — reached exclusively via
 * {@link standUpRealSagaFixture}'s `built.worktrees` branch, which no other fixture profile can
 * enter. Seeds a card carrying ZERO sessions with its `workspace` already resolved (so the real
 * route's `hasWorkspacePayload` body-validation branch is never exercised — this fixture is about
 * the SAGA, not the route's own body-shape check), boots the sandbox server, then drives ONE real
 * `POST /cards/:id/start` carrying no `newSession` flag — the exact request a card's very first
 * "Start" click sends. `start-session.ts`'s own first-start branch names the session after
 * `card.identifier` (`sessionName = card.identifier` when `wantsNewSession` is false), so the
 * resulting tmux name, workspace path and branch are identical in SHAPE to
 * {@link standUpRealSagaFixture}'s own manually-built session 1 for {@link SECOND_SESSION_FIXTURE}
 * — the only difference is WHO creates them: the real saga here, this function there.
 */
async function standUpParityFixtureSession1(built) {
  await seedFixtureRepo(built);
  console.log(
    `standup (real-saga, first-start): fixture repo ready — ${built.repoPath} (base ${built.repoBase})`,
  );

  const now = new Date().toISOString();
  const card = {
    id: built.cardId,
    issueId: `${built.cardId}-issue`,
    identifier: built.identifier,
    title:
      "session-liveness-v3 parity fixture card — 0 sessions, real first start",
    description: null,
    priority: 3,
    column: "todo",
    updatedAt: now,
    workspace: {
      folder: join(built.home, "repos"),
      repos: [{ path: built.repoPath, base: built.repoBase }],
    },
  };
  seedFixtureCard(built.home, card);

  built.pathPrefix = writeHooksCapableStubClaudeBinary(built.home);
  console.log(
    `standup (real-saga, first-start): hooks-capable stub claude planted — ${join(built.pathPrefix, "claude")}`,
  );

  built.server = bootServer(built.home, { pathPrefix: built.pathPrefix });
  await waitForReady(built.port);
  console.log(
    `standup (real-saga, first-start): sandbox server ready on :${built.port}`,
  );

  const res = await fetch(
    `http://127.0.0.1:${built.port}/api/cards/${built.cardId}/start`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ extraDirection: "" }),
    },
  );
  const startBody = await res.json().catch(() => undefined);
  if (res.status !== 202) {
    throw new Error(
      `standup (real-saga, first-start): POST /start returned ${res.status}, expected 202 (body=${JSON.stringify(startBody)})`,
    );
  }

  const { card: settled, timedOut } = await waitForFirstStartSettled(built, {
    timeoutMs: SECOND_SESSION_SAGA_TIMEOUT_MS,
  });
  if (timedOut) {
    throw new Error(
      `standup (real-saga, first-start): saga did not settle within ${SECOND_SESSION_SAGA_TIMEOUT_MS}ms (last observed card=${JSON.stringify(settled)})`,
    );
  }
  if (settled?.startError != null) {
    throw new Error(
      `standup (real-saga, first-start): saga recorded a startError instead of session 1: ${JSON.stringify(settled.startError)}`,
    );
  }

  built.tmux.a = settled.tmuxSession;
  const settledPersisted = readCard(built.dbPath, built.cardId);
  const settledRecord = settledPersisted?.sessions?.find(
    (s) => s.id === settled.activeSession?.id,
  );
  built.sessionA = {
    id: settled.activeSession?.id,
    token: settledRecord?.hookToken,
  };
  built.session1WorkspacePath = join(
    built.home,
    "workspaces",
    built.identifier,
  );
  built.session1WorktreePath = join(built.session1WorkspacePath, "alpha");
  built.session1Branch = built.identifier;
  console.log(
    `standup (real-saga, first-start): session 1 live via real saga — tmux=${built.tmux.a} worktree=${built.session1WorktreePath}`,
  );

  // Every key beyond the first drives one more real `POST /start {newSession:true}` — see
  // PARITY_FIXTURE's own `@remarks` on why `sessionKeys`' length stays load-bearing. The default
  // profile's single-key array means this loop never runs in normal use; it exists so a break that
  // widens `sessionKeys` genuinely produces a real two-session card.
  for (const key of built.sessionKeys.slice(1)) {
    const { status, body } = await startSecondSession(built, {
      newSession: true,
    });
    if (status !== 202) {
      throw new Error(
        `standup (real-saga, first-start): POST /start {newSession:true} for extra key "${key}" returned ${status}, expected 202 (body=${JSON.stringify(body)})`,
      );
    }
    const { card: extraSettled, timedOut: extraTimedOut } =
      await waitForSagaSettled(built, {
        timeoutMs: SECOND_SESSION_SAGA_TIMEOUT_MS,
      });
    if (extraTimedOut) {
      throw new Error(
        `standup (real-saga, first-start): extra session for key "${key}" did not settle within ${SECOND_SESSION_SAGA_TIMEOUT_MS}ms (last observed card=${JSON.stringify(extraSettled)})`,
      );
    }
    if (extraSettled?.startError != null) {
      throw new Error(
        `standup (real-saga, first-start): extra session for key "${key}" recorded a startError: ${JSON.stringify(extraSettled.startError)}`,
      );
    }
    console.log(
      `standup (real-saga, first-start): extra session for key "${key}" live — sessionCount now ${extraSettled.sessionCount}`,
    );
  }
}

async function standUpFixture(built) {
  if (built.realSaga) return standUpRealSagaFixture(built);
  if (built.group) return standUpGroupSessionFixture(built);
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
 * Stand up {@link GROUP_SESSION_FIXTURE}: real tmux+ttyd for every `sessionKeys` entry, exactly the
 * same ordering {@link standUpFixture}'s own remarks document (warmup boot to create the sqlite
 * schema FIRST, then real tmux/ttyd, THEN the fixture cards, THEN the real boot the checks run
 * against) — so the same Phase-90 `in_progress`-ordering pitfall {@link GROUP_SESSION_FIXTURE}'s own
 * doc comment names cannot recur here either. Seeds the PARENT card carrying every session record
 * plus `source: "group"` and `memberIds`, THEN seeds one member card per id in
 * `parent.memberIds` (never independently of it — see {@link GROUP_SESSION_FIXTURE}'s `@remarks`),
 * all before the one real boot at the end. No worktrees, no real saga: this fixture's only subject
 * is the group/member relationship and the multi-session shape on the parent, so it reuses no
 * worktree or real-saga machinery.
 */
async function standUpGroupSessionFixture(built) {
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
      `group fixture tmux sessions did not all come up: missing ${missing.join(", ")}, live=${JSON.stringify(live)}`,
    );
  }
  console.log(
    `standup (group): tmux sessions live — ${built.sessionKeys.map((key) => built.tmux[key]).join(", ")}`,
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
    `standup (group): ttyd ports LISTENING — ${built.sessionKeys.map((key) => `${key}=${built.ttyd[key].port}`).join(", ")}`,
  );

  const now = new Date().toISOString();
  const records = built.sessionKeys.map((key) => ({
    id: handles[key].id,
    createdAt: now,
    updatedAt: now,
    tmuxSession: built.tmux[key],
    ttydPort: built.ttyd[key].port,
    hookToken: handles[key].token,
    workspacePath: join(
      built.home,
      "workspaces",
      WORKSPACE_SUFFIX_BY_SESSION_KEY[key] ?? `GROUP-96-${key}`,
    ),
  }));
  const [activeRecord] = records;

  built.memberAId = `${built.cardId}-member-a`;
  built.memberBId = `${built.cardId}-member-b`;
  const memberIds = [built.memberAId, built.memberBId];

  const parent = {
    id: built.cardId,
    issueId: `${built.cardId}-issue`,
    identifier: "GROUP-961",
    title: `session-liveness-v3 group fixture parent — ${records.length} real sessions, ${memberIds.length} members`,
    description: null,
    priority: 0,
    column: "in_progress",
    updatedAt: now,
    source: "group",
    memberIds,
    sessions: records,
    activeSessionId: activeRecord.id,
    tmuxSession: activeRecord.tmuxSession,
    ttydPort: activeRecord.ttydPort,
    hookToken: activeRecord.hookToken,
    workspacePath: activeRecord.workspacePath,
  };
  seedFixtureCard(built.home, parent);

  const memberTitleByOrdinal = { 0: "A", 1: "B" };
  (parent.memberIds ?? []).forEach((id, i) => {
    seedFixtureCard(built.home, {
      id,
      issueId: `${id}-issue`,
      identifier: `GROUP-96${2 + i}`,
      title: `session-liveness-v3 group fixture member ${memberTitleByOrdinal[i] ?? i}`,
      description: null,
      priority: 3,
      column: "todo",
      updatedAt: now,
      groupId: built.cardId,
    });
  });
  console.log(
    `standup (group): parent=${built.cardId} (memberIds=[${memberIds.join(", ")}]) — ${(parent.memberIds ?? []).length} member card(s) seeded`,
  );

  built.server = bootServer(built.home);
  await waitForReady(built.port);
  console.log(`standup (group): sandbox server ready on :${built.port}`);
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

  // Any OTHER ttyd this fixture's own sessions caused the REAL product to spawn (e.g. via
  // `POST /api/cards/:id/terminal` for a saga-created sibling, tracked in
  // `built.ensuredTerminalSessionIds`) — never tracked in `built.ttyd`, spawned detached, and NOT
  // reaped by the sandbox server's own exit above. Matched by session id, not by tmux name: a
  // running ttyd's own proctitle drops everything from its tmux-attach target onward.
  for (const sessionId of built.ensuredTerminalSessionIds ?? []) {
    await killProcessesMatching(sessionId);
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
    group: profile.group === true,
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
    ensuredTerminalSessionIds: [],
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
 * The exact `DISPATCH_STATUS: DONE — <summary>` Stop-payload text `parse.ts#MARKER_RE` matches —
 * row 9's own way to reach `agent_done`, the one column manual moves can never legally enter
 * (`blocksAgentDoneManualEntry`). `summary` must be unique per call: `applyMarker`'s dedup key is
 * `"DONE " + summary` alone (never gated on the card's current column), so re-posting the SAME
 * summary a second time — row 9 re-enters `agent_done` once per `from=agent_done` pair it drives —
 * would silently no-op on the second call.
 */
function doneBodyWithSummary(summary) {
  return {
    hook_event_name: "Stop",
    last_assistant_message: `⏺ DISPATCH_STATUS: DONE — ${summary}`,
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

/**
 * `moveCard`'s generic counterpart, keyed to an ARBITRARY card id and returning the parsed BODY as
 * well as the status — row 9 needs the response body's `error` text to assert the exact refusal
 * message, never just the status, and needs an arbitrary target because it drives both
 * {@link PARITY_FIXTURE}'s own card and row 9's own throwaway inbox-eligible card.
 */
async function postMoveForCard(built, cardId, column) {
  const res = await fetch(
    `http://127.0.0.1:${built.port}/api/cards/${cardId}/move`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ column }),
    },
  );
  const body = await res.json().catch(() => undefined);
  return { status: res.status, body };
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
 * @remarks `inheritFrom` (Phase 95) rides the same body only when the caller supplies it — every
 * pre-95 call site destructures `{ newSession }` alone, so `inheritFrom` is `undefined` for them
 * and the conditional spread below omits the key entirely, keeping their request body byte-for-byte
 * unchanged.
 */
async function startSecondSession(built, { newSession, inheritFrom }) {
  const res = await fetch(
    `http://127.0.0.1:${built.port}/api/cards/${built.cardId}/start`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        extraDirection: "",
        newSession,
        ...(inheritFrom != null ? { inheritFrom } : {}),
      }),
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

/**
 * SIGTERM (then SIGKILL after a settle window) every process whose full command line contains
 * `needle` — the general-purpose sibling of {@link psScanContains}'s read-only probe. Required
 * because a session brought up via the REAL `/api/cards/:id/terminal` route (not this harness's
 * own {@link spawnTtyd}) spawns a ttyd this fixture never recorded a handle for: `ensureTtyd`
 * launches it `{ detached: true }` (`ttyd.ts`, deliberate — a ttyd must outlive a backend reload)
 * and the sandbox server's own process exit does not reap it. `needle` must be a SESSION ID (the
 * `-b /sessions/<id>/terminal` flag), never the tmux session name: once running, ttyd rewrites its
 * own process title and `ps` reports its argv truncated from the tmux-attach target onward (the
 * SAME pre-2.7.0 ttyd proctitle behavior this codebase has hit before), so a tmux-name substring
 * silently matches nothing — live-caught leaking a real ttyd process past this check's own run
 * (94-07-SUMMARY.md Deviations).
 */
async function killProcessesMatching(needle) {
  let pids;
  try {
    const { stdout } = await execFileP("ps", ["-ax", "-o", "pid=,command="]);
    pids = stdout
      .split("\n")
      .filter((line) => line.includes(needle))
      .map((line) => Number(line.trim().split(/\s+/)[0]))
      .filter((pid) => Number.isInteger(pid));
  } catch {
    return;
  }
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // already gone
    }
  }
  if (pids.length > 0) await sleep(300);
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // already gone
    }
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
 * promotion (`card.tmuxSession`, the flat mirror, becoming B's — F-96-F narrowed `activeSession`
 * off `tmuxSession` since the flat mirror already carries it) — the wire is enough because the
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
        transitioned = lastWireCard?.tmuxSession === survivingTmux;
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
      if (lastWireCard?.tmuxSession !== survivingTmux) {
        violations.push(
          `liveness (${kind}): wire card.tmuxSession (flat mirror) expected the untouched ${survivingTmux}, actual ${lastWireCard?.tmuxSession}`,
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
    if (deterministicCard.activeSession?.ttydPort !== known.ttydPort) {
      violations.push(
        `switch-atomicity: interleaving 1 deterministic follow-up — activeSession.ttydPort expected ${known.ttydPort}, actual ${JSON.stringify(deterministicCard.activeSession?.ttydPort)}`,
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
 * @remarks Records `sessionId` onto `built.ensuredTerminalSessionIds` the instant the ensure-route
 * accepts (202), not only on full success below — `ensureTtyd` may have already spawned the real
 * ttyd process even if this function's own WS-open poll times out, and `ps`'s view of a running
 * ttyd's argv drops everything from its tmux-attach target onward (proctitle rewrite; the SAME
 * pre-2.7.0 ttyd behavior this codebase has hit before), so teardown cannot discover it by tmux
 * name — only by the session id still visible in its `-b /sessions/<id>/terminal` flag.
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
  built.ensuredTerminalSessionIds.push(sessionId);
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
  } else {
    // Only attempt the answerability round trip when the tmux name itself is confirmed present —
    // sending keys to an already-vanished session throws (and, if it was the tmux server's LAST
    // session, tears the whole server down), which would surface as an opaque "run failed"
    // exception instead of the clean, named violation above. The name-missing case is already a
    // strictly stronger finding on its own; there is nothing left to answer.
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
 * Direction 3 (Phase 96 plan 11, closing R2): the raw tmux-targeting proof underlying Direction
 * 2's own doc comment above. Direction 2 already documents that once session 1's exact tmux name
 * is absent while the suffixed sibling is alive, a BARE `-t`-targeted `capturePane`/`sendKeys`/
 * `pasteBuffer` call silently PREFIX-MATCHES onto the sibling and reports success rather than
 * throwing — this direction proves that claim DIRECTLY against the two real, live-created tmux
 * sessions the N=2 fixture stands up, rather than inferring it from the saga's eventual outcome.
 * It issues the exact argv shapes `steps.ts` builds: the bare form (what `awaitReplReady`/
 * `sendKickoff` used before this plan's fix) and the trailing-colon exact-match form (`=<name>:`,
 * what they build now), against the SAME live N=2 state. Both legs run unconditionally — this is
 * a property of tmux's own target resolution, not of which form `steps.ts` currently happens to
 * build — so this direction proves the hazard AND the fix on every run, not just once at the
 * moment of the fix.
 * @see docs/ARCHITECTURE.md#tmux-invocations
 */
async function checkSecondStartRollbackDirection3(built) {
  const violations = [];
  const session1Name = built.tmux.a;

  const { status, body } = await startSecondSession(built, {
    newSession: true,
  });
  console.log(
    `second-start-rollback (d3): POST /start {newSession:true} (session 2 setup) -> ${status}`,
  );
  if (status !== 202) {
    violations.push(
      `second-start-rollback (d3): session 2 setup POST /start returned ${status}, expected 202 (body=${JSON.stringify(body)})`,
    );
    return violations;
  }
  const { card, timedOut } = await waitForSagaSettled(built, {
    timeoutMs: SECOND_SESSION_SAGA_TIMEOUT_MS,
  });
  if (timedOut) {
    violations.push(
      `second-start-rollback (d3): session 2 setup saga did not settle within ${SECOND_SESSION_SAGA_TIMEOUT_MS}ms (last observed card=${JSON.stringify(card)})`,
    );
    return violations;
  }
  if (card?.startError != null) {
    violations.push(
      `second-start-rollback (d3): session 2 setup recorded a startError: ${JSON.stringify(card.startError)}`,
    );
    return violations;
  }
  const session2Name = `dsp-${built.identifier}-2`;
  const liveSetup = await tmuxListSessionNames();
  if (!liveSetup.includes(session2Name)) {
    violations.push(
      `second-start-rollback (d3): session 2's EXACT tmux name ${session2Name} not found right after creation: ${JSON.stringify(liveSetup)}`,
    );
    return violations;
  }

  // A unique marker written into session 2's own pane, so a cross-session read is provable by
  // CONTENT, not inferred from a READY-pattern coincidence.
  const marker = `d3-marker-${randomBytes(4).toString("hex")}`;
  await writePaneMarker(session2Name, built.home, marker);
  await sleep(POLL_INTERVAL_MS);
  const session2Own = await execFileP("tmux", [
    "capture-pane",
    "-p",
    "-t",
    `=${session2Name}:`,
  ]).catch((err) => ({ stdout: "", err: err.stderr ?? err.message }));
  if (!(session2Own.stdout ?? "").includes(marker)) {
    violations.push(
      `second-start-rollback (d3): session 2's own marker "${marker}" never landed in its own pane before the cross-session probe (${JSON.stringify(session2Own)}) — fixture itself is not answerable`,
    );
    return violations;
  }

  await tmuxKillSessionExact(session1Name);
  const liveAfterKill = await tmuxListSessionNames();
  console.log(
    `second-start-rollback (d3): session 1 exact name killed; live sessions = ${JSON.stringify(liveAfterKill)}`,
  );
  if (liveAfterKill.includes(session1Name)) {
    violations.push(
      `second-start-rollback (d3): session 1's exact tmux name ${session1Name} still present after an exact-match kill — fixture precondition (exact session ABSENT) not met`,
    );
    return violations;
  }
  if (!liveAfterKill.includes(session2Name)) {
    violations.push(
      `second-start-rollback (d3): session 2's exact tmux name ${session2Name} missing after killing session 1 — fixture precondition (suffixed sibling PRESENT) not met`,
    );
    return violations;
  }

  // BEFORE leg — the bare, unprefixed form awaitReplReady/sendKickoff issued before this plan's
  // fix. Real tmux 3.6a target resolution, not product code under test here.
  let bareCapture;
  try {
    const { stdout } = await execFileP("tmux", [
      "capture-pane",
      "-p",
      "-t",
      session1Name,
    ]);
    bareCapture = { resolved: true, stdout };
  } catch (err) {
    bareCapture = { resolved: false, stderr: err.stderr ?? err.message };
  }
  console.log(
    `second-start-rollback (d3): BEFORE (bare target "${session1Name}") capture-pane -> ${JSON.stringify(bareCapture)}`,
  );
  if (!bareCapture.resolved || !(bareCapture.stdout ?? "").includes(marker)) {
    violations.push(
      `second-start-rollback (d3): BEFORE leg expected the bare capture-pane target to silently resolve onto session 2's marker "${marker}" (the documented tmux 3.6a hazard) but got ${JSON.stringify(bareCapture)} — either the hazard no longer reproduces on this tmux version or the fixture drifted; the "before" half of R2's proof did not fire as expected`,
    );
  }

  let bareSendKeysResolved = true;
  try {
    await execFileP("tmux", [
      "send-keys",
      "-t",
      session1Name,
      "-l",
      "--",
      "echo d3-BEFORE-bare-sendkeys",
    ]);
    await execFileP("tmux", ["send-keys", "-t", session1Name, "Enter"]);
  } catch {
    bareSendKeysResolved = false;
  }
  await sleep(POLL_INTERVAL_MS);
  const session2AfterBareSendKeys = await execFileP("tmux", [
    "capture-pane",
    "-p",
    "-t",
    `=${session2Name}:`,
  ]).catch(() => ({ stdout: "" }));
  const bareSendKeysLandedOnSibling =
    bareSendKeysResolved &&
    (session2AfterBareSendKeys.stdout ?? "").includes(
      "d3-BEFORE-bare-sendkeys",
    );
  console.log(
    `second-start-rollback (d3): BEFORE (bare target) send-keys resolved=${bareSendKeysResolved}, landed on sibling's pane=${bareSendKeysLandedOnSibling}`,
  );
  if (!bareSendKeysLandedOnSibling) {
    violations.push(
      `second-start-rollback (d3): BEFORE leg expected the bare send-keys target to silently misdeliver onto session 2's pane, got resolved=${bareSendKeysResolved} landedOnSibling=${bareSendKeysLandedOnSibling}`,
    );
  }

  // AFTER leg — the trailing-colon exact-match form awaitReplReady/sendKickoff build now. Must
  // fail LOUDLY rather than silently succeeding against the wrong pane.
  let exactCapture;
  try {
    const { stdout } = await execFileP("tmux", [
      "capture-pane",
      "-p",
      "-t",
      `=${session1Name}:`,
    ]);
    exactCapture = { resolved: true, stdout };
  } catch (err) {
    exactCapture = { resolved: false, stderr: err.stderr ?? err.message };
  }
  console.log(
    `second-start-rollback (d3): AFTER (exact-match "=${session1Name}:") capture-pane -> ${JSON.stringify(exactCapture)}`,
  );
  if (exactCapture.resolved) {
    violations.push(
      `second-start-rollback (d3): AFTER leg expected the exact-match capture-pane target to FAIL (no exact session, no fallback to the sibling) but it resolved: ${JSON.stringify(exactCapture)}`,
    );
  }

  let exactSendKeysFailed = false;
  try {
    await execFileP("tmux", [
      "send-keys",
      "-t",
      `=${session1Name}:`,
      "-l",
      "--",
      "echo d3-AFTER-exact-sendkeys",
    ]);
  } catch (err) {
    exactSendKeysFailed = true;
    console.log(
      `second-start-rollback (d3): AFTER (exact-match) send-keys correctly failed — ${err.stderr ?? err.message}`,
    );
  }
  if (!exactSendKeysFailed) {
    violations.push(
      `second-start-rollback (d3): AFTER leg expected the exact-match send-keys target to FAIL, but it resolved without error`,
    );
  }

  return violations;
}

/**
 * `--check second-start-rollback` (Plan 94-07, criterion C3, START-02; Direction 3 added by Phase
 * 96 plan 11): the three directions, each its own fresh {@link SECOND_SESSION_FIXTURE} instance —
 * a failing SECOND start must not disturb session 1 (Direction 1, proves Break A: removing the
 * rollback call), a failing FIRST-session rollback must not kill the suffixed sibling (Direction
 * 2, proves Break B: the tmux prefix-kill, Phase 94's headline defect), and the raw tmux-targeting
 * proof that `steps.ts`'s kickoff-path calls now use the safe exact-match form (Direction 3,
 * closes Phase 94's residual R2 / Phase 96 finding).
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
  violations.push(
    ...(await withFixture(
      "second-start-rollback-d3",
      checkSecondStartRollbackDirection3,
      SECOND_SESSION_FIXTURE,
    )),
  );
  return violations;
}

/**
 * Poll the PERSISTED card until `predicate` holds for it, returning `{ card, timedOut }` rather
 * than throwing, so a caller reports the LAST OBSERVED state inside a named violation instead of an
 * opaque exception. Reads through a fresh `readOnly: true` connection every poll — never through
 * the live server process — because the subject here is what actually landed on disk.
 */
async function waitForPersistedCard(built, predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let card;
  while (Date.now() < deadline) {
    card = readCard(built.dbPath, built.cardId);
    if (card != null && predicate(card)) return { card, timedOut: false };
    await sleep(POLL_INTERVAL_MS * 5);
  }
  return { card, timedOut: true };
}

/**
 * Ceiling for the artifact probe's self-rescheduling ~10s tick
 * (`artifact-detect.ts`'s `ARTIFACT_DETECT_INTERVAL_MS`). Generous rather than tight: the check
 * must POLL for a tick, never assume one has run, and a single missed tick boundary must not
 * produce a false "attribution never landed" violation. Two failure-backoff doublings (10s + 20s)
 * plus a full interval still fits inside this.
 */
const ARTIFACT_TICK_TIMEOUT_MS = 45_000;

/**
 * Criterion 6 / `ARTIFACT-01`: with two branches live, each session's PRs are attributed to its own
 * branch and readable on its OWN record.
 *
 * @remarks The subject is deliberately the NON-ACTIVE sibling, and assertion 1 targets it by id and
 * branch. The regression this criterion exists to catch reverts the probe's input to
 * `cards.map((c) => c.tmuxSession)` — under which the ACTIVE session is still probed correctly, so
 * an assertion made against the active session PASSES while attribution is completely broken. That
 * is the vacuous form this codebase has now caught fifteen times; plan 94-08's Task 2 demonstrates
 * it explicitly by weakening this check and watching it pass under the same break.
 *
 * The two sessions' expected PR sets are DIFFERENT ({@link expectedStubPrNumber} derives each from
 * its own branch), so a probe that broadcasts one session's result onto its sibling fails
 * assertions 1-3 rather than coincidentally satisfying them.
 */
async function checkArtifactAttribution(built) {
  const violations = [];

  const n1Wire = await fetchFixtureCard(built);
  if (n1Wire?.sessionSummaries != null || n1Wire?.sessionCount != null) {
    violations.push(
      `artifact-attribution: N=1 wire parity broken BEFORE the second session — sessionSummaries=${JSON.stringify(n1Wire?.sessionSummaries)}, sessionCount=${JSON.stringify(n1Wire?.sessionCount)}, both must be absent at N=1`,
    );
  } else {
    console.log(
      "artifact-attribution: N=1 wire parity — sessionSummaries and sessionCount both absent",
    );
  }

  const { ghPath, failFile } = writeStubGhBinary(built.home);
  console.log(`artifact-attribution: stub gh planted — ${ghPath}`);

  const { status, body } = await startSecondSession(built, {
    newSession: true,
  });
  if (status !== 202) {
    violations.push(
      `artifact-attribution: POST /start {newSession:true} returned ${status}, expected 202 (body=${JSON.stringify(body)})`,
    );
    return violations;
  }
  const { card: settled, timedOut: sagaTimedOut } = await waitForSagaSettled(
    built,
    { timeoutMs: SECOND_SESSION_SAGA_TIMEOUT_MS },
  );
  if (sagaTimedOut || settled?.startError != null) {
    violations.push(
      `artifact-attribution: second start did not settle cleanly (timedOut=${sagaTimedOut}, startError=${JSON.stringify(settled?.startError)})`,
    );
    return violations;
  }

  const branch1 = built.identifier;
  const branch2 = `${built.identifier}-2`;
  const expected1 = expectedStubPrNumber(branch1);
  const expected2 = expectedStubPrNumber(branch2);
  if (expected1 === expected2) {
    violations.push(
      `artifact-attribution: the fixture's two expected PR sets are IDENTICAL (${expected1}) — this check cannot tell correct attribution from a broadcast and is a dead instrument`,
    );
    return violations;
  }
  console.log(
    `artifact-attribution: expecting PR #${expected1} on ${branch1}, PR #${expected2} on ${branch2}`,
  );

  const { card: probed, timedOut } = await waitForPersistedCard(
    built,
    (c) => (c.sessions ?? []).every((s) => s.prs != null),
    ARTIFACT_TICK_TIMEOUT_MS,
  );
  if (timedOut) {
    violations.push(
      `artifact-attribution: no probe tick attributed PRs to both sessions within ${ARTIFACT_TICK_TIMEOUT_MS}ms (last persisted sessions=${JSON.stringify((probed?.sessions ?? []).map((s) => ({ id: s.id, branch: s.branch, prs: s.prs, prsUnknown: s.prsUnknown })))})`,
    );
    return violations;
  }

  const sessions = probed.sessions ?? [];
  const active = sessions.find((s) => s.id === probed.activeSessionId);
  const sibling = sessions.find((s) => s.id !== probed.activeSessionId);
  for (const s of sessions) {
    console.log(
      `artifact-attribution: session ${s.id} branch=${s.branch} prs=${JSON.stringify((s.prs ?? []).map((p) => p.number))} active=${s.id === probed.activeSessionId}`,
    );
  }
  if (active == null || sibling == null) {
    violations.push(
      `artifact-attribution: expected exactly one active and one non-active session, got ${sessions.length} record(s) with activeSessionId=${probed.activeSessionId}`,
    );
    return violations;
  }

  const numbersOf = (rec) => (rec.prs ?? []).map((p) => p.number).sort();
  const expectedFor = (rec) => [expectedStubPrNumber(rec.branch ?? "")];

  const siblingNums = numbersOf(sibling);
  if (JSON.stringify(siblingNums) !== JSON.stringify(expectedFor(sibling))) {
    violations.push(
      `artifact-attribution: NON-ACTIVE sibling ${sibling.id} (branch ${sibling.branch}) carries prs ${JSON.stringify(siblingNums)}, expected ${JSON.stringify(expectedFor(sibling))} — its own branch's set, not the active session's and not undefined`,
    );
  }

  const activeNums = numbersOf(active);
  if (JSON.stringify(activeNums) !== JSON.stringify(expectedFor(active))) {
    violations.push(
      `artifact-attribution: ACTIVE session ${active.id} (branch ${active.branch}) carries prs ${JSON.stringify(activeNums)}, expected ${JSON.stringify(expectedFor(active))}`,
    );
  }
  if (JSON.stringify(siblingNums) === JSON.stringify(activeNums)) {
    violations.push(
      `artifact-attribution: both sessions carry the SAME prs ${JSON.stringify(activeNums)} — a broadcast, not attribution`,
    );
  }

  if (sibling.workspace == null) {
    violations.push(
      `artifact-attribution: the NON-ACTIVE sibling ${sibling.id} has no \`workspace\` — the artifact probe gates on \`rec.workspace != null\`, so this session can never be probed for PRs at all`,
    );
  }
  if (probed.workspace == null) {
    violations.push(
      `artifact-attribution: card.workspace was WIPED by the second session completing — the closing six-field mirror re-derives it from the newly promoted record, and \`cleanupWorkspace\` reads \`card.workspace.repos\``,
    );
  }

  const cardNums = (probed.prs ?? []).map((p) => p.number).sort();
  if (JSON.stringify(cardNums) !== JSON.stringify(activeNums)) {
    violations.push(
      `artifact-attribution: card.prs mirror is ${JSON.stringify(cardNums)}, expected the ACTIVE session's ${JSON.stringify(activeNums)} (sibling's is ${JSON.stringify(siblingNums)})`,
    );
  }

  const wire = await fetchFixtureCard(built);
  const summaries = wire?.sessionSummaries ?? [];
  if (summaries.length !== 2) {
    violations.push(
      `artifact-attribution: wire sessionSummaries has ${summaries.length} entries, expected 2`,
    );
  } else {
    const wireSibling = summaries.find((s) => s.id === sibling.id);
    const wireNums = (wireSibling?.prs ?? []).map((p) => p.number).sort();
    if (JSON.stringify(wireNums) !== JSON.stringify(expectedFor(sibling))) {
      violations.push(
        `artifact-attribution: the sibling's WIRE sessionSummaries entry carries prs ${JSON.stringify(wireNums)}, expected ${JSON.stringify(expectedFor(sibling))} — per-session artifacts must be observable at N>=2`,
      );
    }
  }

  writeFileSync(failFile, sibling.branch ?? "");
  console.log(
    `artifact-attribution: injecting probe failure for the sibling's branch only — ${sibling.branch}`,
  );
  const activeBefore = numbersOf(active);
  const { card: afterFail, timedOut: failTimedOut } =
    await waitForPersistedCard(
      built,
      (c) =>
        (c.sessions ?? []).find((s) => s.id === sibling.id)?.prsUnknown != null,
      ARTIFACT_TICK_TIMEOUT_MS,
    );
  if (failTimedOut) {
    violations.push(
      `artifact-attribution: the sibling never gained prsUnknown after its branch's probe was made to fail within ${ARTIFACT_TICK_TIMEOUT_MS}ms — per-session failure tracking unproven`,
    );
  } else {
    const activeAfter = (
      (afterFail.sessions ?? []).find((s) => s.id === active.id)?.prs ?? []
    )
      .map((p) => p.number)
      .sort();
    if (JSON.stringify(activeAfter) !== JSON.stringify(activeBefore)) {
      violations.push(
        `artifact-attribution: the ACTIVE session's prs changed from ${JSON.stringify(activeBefore)} to ${JSON.stringify(activeAfter)} while only its SIBLING's probe was failing — the failure streak and retry backoff are shared, not per session`,
      );
    } else {
      console.log(
        `artifact-attribution: sibling gained prsUnknown while the active session's prs stayed ${JSON.stringify(activeAfter)} — backoff is per session`,
      );
    }
  }
  writeFileSync(failFile, "");

  return violations;
}

/**
 * `--check inherit-ancestry` (Plan 95-05 Task 1, criterion C1, MULTI-02): drives a REAL inherited
 * start (`inheritFrom` naming session 1) and proves session 2's branch genuinely descends from
 * session 1's own committed history, proves the fetch-skip 95-03 exists to guarantee, and proves
 * the child's agent was told what it was built on.
 *
 * THIS CHECK'S OWN DEAD-INSTRUMENT TRAP, 95-VALIDATION.md's sharpest one: `git merge-base
 * --is-ancestor <parent-tip> <child-branch>` would ALSO exit 0 for a child cut fresh from the
 * repo's base if the fixture's parent branch carried no commit of its own beyond that base —
 * because the parent tip WOULD BE the base tip, and every branch descends from the base. Step A
 * below asserts `PARENT_TIP !== BASE_TIP` as a violation of its own, with an early return BEFORE
 * any ancestry assertion runs: a future fixture regression that drops the parent's own commit makes
 * this check report itself dead, never a false pass. `standUpRealSagaFixture` already commits
 * `"fixture session 1"` after the branch point (`:1391-1400`), so this guard holds on a healthy
 * tree today — it is still asserted rather than trusted.
 * @remarks Step C's ancestry proof is deliberately TWO assertions: `is-ancestor` exiting 0 is
 * exactly the assertion the trap above defeats, so the named `PARENT_TIP` sha's literal presence in
 * `git rev-list <childBranch>` is also checked.
 * @remarks Step E deliberately never substring-matches the PARENT's branch name in the captured
 * pane — the CHILD's own branch (`<identifier>-2`) CONTAINS the parent's (`<identifier>`) as a
 * prefix, so that assertion would pass vacuously. The kickoff's `## Building on a previous session`
 * heading (`kickoff.ts`) is the collision-free anchor.
 */
async function checkInheritAncestry(built) {
  const violations = [];

  // --- A. Establish the named parent commit, and prove the instrument is not dead. ---
  const PARENT_TIP = (
    await execFileP(
      "git",
      ["rev-parse", "refs/heads/" + built.session1Branch],
      { cwd: built.repoPath },
    )
  ).stdout.trim();
  const BASE_TIP = (
    await execFileP("git", ["rev-parse", "refs/heads/" + built.repoBase], {
      cwd: built.repoPath,
    })
  ).stdout.trim();
  console.log(
    `inherit-ancestry: PARENT_TIP (branch ${built.session1Branch}) = ${PARENT_TIP}, BASE_TIP (branch ${built.repoBase}) = ${BASE_TIP}`,
  );
  if (PARENT_TIP === BASE_TIP) {
    violations.push(
      `inherit-ancestry: DEAD INSTRUMENT — the fixture's parent branch "${built.session1Branch}" (PARENT_TIP=${PARENT_TIP}) carries no commit of its own beyond the repo's base branch "${built.repoBase}" (BASE_TIP=${BASE_TIP}); they are the SAME commit. "git merge-base --is-ancestor" cannot distinguish genuine inheritance from a child cut fresh off the base in this state, so this check refuses to run the ancestry assertion and report a pass.`,
    );
    return violations;
  }

  // --- B. Drive a REAL inherited start. ---
  const { status, body } = await startSecondSession(built, {
    newSession: true,
    inheritFrom: built.sessionA.id,
  });
  console.log(
    `inherit-ancestry: POST /start {newSession:true, inheritFrom:${built.sessionA.id}} -> ${status}`,
  );
  if (status !== 202) {
    violations.push(
      `inherit-ancestry: POST /start returned ${status}, expected 202 (body=${JSON.stringify(body)})`,
    );
    return violations;
  }

  const { card, timedOut } = await waitForSagaSettled(built, {
    timeoutMs: SECOND_SESSION_SAGA_TIMEOUT_MS,
  });
  if (timedOut) {
    violations.push(
      `inherit-ancestry: saga did not settle within ${SECOND_SESSION_SAGA_TIMEOUT_MS}ms (last observed card=${JSON.stringify(card)})`,
    );
    return violations;
  }
  if (card?.startError != null) {
    violations.push(
      `inherit-ancestry: saga recorded a startError instead of an inherited second session: ${JSON.stringify(card.startError)}`,
    );
    return violations;
  }

  const childId = (card?.sessionSummaries ?? [])
    .map((s) => s.id)
    .find((id) => id !== built.sessionA.id);
  if (!childId) {
    violations.push(
      `inherit-ancestry: could not resolve the child session's id from sessionSummaries=${JSON.stringify(card?.sessionSummaries)}`,
    );
    return violations;
  }
  const childBranch = built.identifier + "-2";
  console.log(
    `inherit-ancestry: parent session=${built.sessionA.id} (branch ${built.session1Branch}), child session=${childId} (expected branch ${childBranch})`,
  );

  // --- C. Assert positively on the CHILD (fan-out) — never only that the parent was undisturbed. ---
  let ancestorExitsZero = true;
  try {
    await execFileP(
      "git",
      ["merge-base", "--is-ancestor", PARENT_TIP, childBranch],
      { cwd: built.repoPath },
    );
  } catch (err) {
    ancestorExitsZero = false;
    violations.push(
      `inherit-ancestry: "git merge-base --is-ancestor ${PARENT_TIP} ${childBranch}" did not exit 0: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  console.log(
    `inherit-ancestry: is-ancestor(${PARENT_TIP}, ${childBranch}) exits 0 = ${ancestorExitsZero}`,
  );

  const revListShas = (
    await execFileP("git", ["rev-list", childBranch], { cwd: built.repoPath })
  ).stdout
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const revListContainsParentTip = revListShas.includes(PARENT_TIP);
  console.log(
    `inherit-ancestry: git rev-list ${childBranch} contains PARENT_TIP ${PARENT_TIP} = ${revListContainsParentTip} (${revListShas.length} commits total)`,
  );
  if (!revListContainsParentTip) {
    violations.push(
      `inherit-ancestry: "git rev-list ${childBranch}" does NOT literally contain the named PARENT_TIP sha ${PARENT_TIP} — this is the assertion the bare is-ancestor exit code alone cannot prove (rev-list output: ${JSON.stringify(revListShas)})`,
    );
  }

  if (childBranch === built.session1Branch) {
    violations.push(
      `inherit-ancestry: child branch equals the parent's own branch "${childBranch}" — expected a distinct sibling branch`,
    );
  }

  const session2WorkspacePath = join(built.home, "workspaces", childBranch);
  const session2WtPath = join(session2WorkspacePath, "alpha");
  if (session2WtPath === built.session1WorktreePath) {
    violations.push(
      `inherit-ancestry: child worktree path equals the parent's own worktree path (${session2WtPath})`,
    );
  }
  if (!existsSync(session2WtPath)) {
    violations.push(
      `inherit-ancestry: child worktree directory does not exist: ${session2WtPath}`,
    );
  }

  const persisted = readCard(built.dbPath, built.cardId);
  const childRecord = persisted?.sessions?.find((s) => s.id === childId);
  console.log(
    `inherit-ancestry: persisted child session ${childId} builtFrom = ${JSON.stringify(childRecord?.builtFrom)} (expected parent id ${built.sessionA.id})`,
  );
  if (childRecord?.builtFrom !== built.sessionA.id) {
    violations.push(
      `inherit-ancestry: persisted child session ${childId}'s builtFrom is ${JSON.stringify(childRecord?.builtFrom)}, expected the parent's id ${built.sessionA.id}`,
    );
  }

  // --- D. Assert the fetch-skip — the trap Plan 95-03 exists to avoid. ---
  const boardText = await (
    await fetch(`http://127.0.0.1:${built.port}/api/board`)
  ).text();
  const fetchOriginCount = (boardText.match(/git fetch origin/g) ?? []).length;
  const failedInCount = (boardText.match(/failed in/g) ?? []).length;
  console.log(
    `inherit-ancestry: board JSON occurrences — "git fetch origin"=${fetchOriginCount}, "failed in"=${failedInCount}; card.startWarning=${JSON.stringify(card?.startWarning)}`,
  );
  if (card?.startWarning != null) {
    violations.push(
      `inherit-ancestry: card.startWarning is "${card.startWarning}" — an inherited start must skip fetchBase entirely and emit no warning; this string names which branch was fetched and is the whole diagnosis`,
    );
  }
  if (fetchOriginCount > 0 || failedInCount > 0) {
    violations.push(
      `inherit-ancestry: the board JSON itself contains a fetch-failure trace ("git fetch origin" x${fetchOriginCount}, "failed in" x${failedInCount}) — an inherited start must never reach fetchBase at all`,
    );
  }

  // --- E. Assert the kickoff reached the child's agent. ---
  const childTmuxName = "dsp-" + built.identifier + "-2";
  const childPane = (
    await execFileP("tmux", [
      "capture-pane",
      "-p",
      "-t",
      "=dsp-" + built.identifier + "-2:",
      "-S",
      "-",
    ])
  ).stdout;
  const normalizedChildPane = childPane.replace(/\n/g, " ");
  const kickoffHeading = "## Building on a previous session";
  const paneHasHeading = normalizedChildPane.includes(kickoffHeading);
  console.log(
    `inherit-ancestry: child pane (${childTmuxName}, full scrollback, newline-stripped) contains "${kickoffHeading}" = ${paneHasHeading}`,
  );
  if (!paneHasHeading) {
    violations.push(
      `inherit-ancestry: the child's tmux pane (${childTmuxName}) does not contain the literal kickoff heading "${kickoffHeading}" — the child's agent was never told what it was built on. Captured pane (first 2000 chars): ${JSON.stringify(childPane.slice(0, 2000))}`,
    );
  }

  return violations;
}

/**
 * `--check inherit-parent-intact` (Plan 95-05 Task 2, criterion C2, MULTI-02): proves the parent
 * session's worktree is byte-identical, its planted uncommitted work never crosses into the child,
 * and its EXACT tmux session still answers a REAL typed round trip after a real inherited child
 * starts — plus the fan-out shape (95-VALIDATION.md, carried from Phase 93's gate): the child is
 * asserted to start exactly at the parent's committed tip, never only that the parent survived.
 * @remarks Step A plants uncommitted work BEFORE capturing the parent's before-state so the
 * porcelain comparison in Step E cannot compare two empty strings — an empty-porcelain fixture
 * would make that comparison pass even if the worktree were destroyed and silently recreated
 * (95-VALIDATION.md's dead-instrument discipline). Step B refuses early, the same discipline as
 * Task 1's `PARENT_TIP === BASE_TIP` guard, if that plant somehow left the porcelain empty.
 * @remarks Every `has-session` target below uses the colon-LESS `=<name>` exact-match form; every
 * `send-keys`/`capture-pane` target uses the TRAILING-COLON `=<name>:` form — the tmux 3.6a
 * determinant this whole plan's fixture depends on (94-VALIDATION.md, corrected 2026-08-19). A bare
 * (unprefixed) target is never used: `dsp-<identifier>` and `dsp-<identifier>-2` are a genuine
 * PREFIX pair here, so a bare target would read the wrong session and pass regardless of the truth.
 */
async function checkInheritParentIntact(built) {
  const violations = [];

  const parentTmuxName = "dsp-" + built.identifier;
  const childTmuxName = "dsp-" + built.identifier + "-2";

  // --- A. Plant uncommitted work in the parent's worktree, BEFORE the child starts. ---
  const plantedFileName = "parent-uncommitted.txt";
  writeFileSync(
    join(built.session1WorktreePath, plantedFileName),
    "parent's own uncommitted work — must never transfer to a child\n",
  );

  // --- B. Capture the parent's before-state. ---
  const PARENT_HEAD_BEFORE = (
    await execFileP("git", ["rev-parse", "HEAD"], {
      cwd: built.session1WorktreePath,
    })
  ).stdout.trim();
  const PARENT_PORCELAIN_BEFORE = (
    await execFileP("git", ["status", "--porcelain"], {
      cwd: built.session1WorktreePath,
    })
  ).stdout;
  console.log(
    `inherit-parent-intact: PARENT_HEAD_BEFORE=${PARENT_HEAD_BEFORE}, PARENT_PORCELAIN_BEFORE=${JSON.stringify(PARENT_PORCELAIN_BEFORE)}`,
  );
  if (PARENT_PORCELAIN_BEFORE.trim() === "") {
    violations.push(
      `inherit-parent-intact: DEAD INSTRUMENT — the planted file "${plantedFileName}" did not register in \`git status --porcelain\` (before-state is empty), so the before/after porcelain comparison below would be vacuous even if the worktree were destroyed and recreated. Refusing to continue.`,
    );
    return violations;
  }

  // --- C. Drive the real inherited start. ---
  const { status, body } = await startSecondSession(built, {
    newSession: true,
    inheritFrom: built.sessionA.id,
  });
  console.log(
    `inherit-parent-intact: POST /start {newSession:true, inheritFrom:${built.sessionA.id}} -> ${status}`,
  );
  if (status !== 202) {
    violations.push(
      `inherit-parent-intact: POST /start returned ${status}, expected 202 (body=${JSON.stringify(body)})`,
    );
    return violations;
  }

  const { card, timedOut } = await waitForSagaSettled(built, {
    timeoutMs: SECOND_SESSION_SAGA_TIMEOUT_MS,
  });
  if (timedOut) {
    violations.push(
      `inherit-parent-intact: saga did not settle within ${SECOND_SESSION_SAGA_TIMEOUT_MS}ms (last observed card=${JSON.stringify(card)})`,
    );
    return violations;
  }
  if (card?.startError != null) {
    violations.push(
      `inherit-parent-intact: saga recorded a startError instead of an inherited second session: ${JSON.stringify(card.startError)}`,
    );
    return violations;
  }

  const childId = (card?.sessionSummaries ?? [])
    .map((s) => s.id)
    .find((id) => id !== built.sessionA.id);
  if (!childId) {
    violations.push(
      `inherit-parent-intact: could not resolve the child session's id from sessionSummaries=${JSON.stringify(card?.sessionSummaries)}`,
    );
    return violations;
  }
  console.log(
    `inherit-parent-intact: parent session=${built.sessionA.id} (${parentTmuxName}), child session=${childId} (${childTmuxName})`,
  );

  // --- D. Assert positively on the CHILD (fan-out), not only that the parent survived. ---
  const childWorkspacePath = join(
    built.home,
    "workspaces",
    built.identifier + "-2",
  );
  const childWtPath = join(childWorkspacePath, "alpha");
  if (!existsSync(childWtPath)) {
    violations.push(
      `inherit-parent-intact: child worktree directory does not exist: ${childWtPath}`,
    );
  } else if (childWtPath === built.session1WorktreePath) {
    violations.push(
      `inherit-parent-intact: child worktree path equals the parent's own worktree path (${childWtPath})`,
    );
  } else {
    const childHasPlantedFile = existsSync(join(childWtPath, plantedFileName));
    console.log(
      `inherit-parent-intact: child worktree (${childWtPath}) contains "${plantedFileName}" = ${childHasPlantedFile} (expected false — uncommitted work does not transfer)`,
    );
    if (childHasPlantedFile) {
      violations.push(
        `inherit-parent-intact: the child's worktree (${childWtPath}) contains "${plantedFileName}" — the parent's UNCOMMITTED work crossed into the child, violating the documented boundary`,
      );
    }

    const childHead = (
      await execFileP("git", ["rev-parse", "HEAD"], { cwd: childWtPath })
    ).stdout.trim();
    console.log(
      `inherit-parent-intact: child HEAD=${childHead}, expected PARENT_HEAD_BEFORE=${PARENT_HEAD_BEFORE}`,
    );
    if (childHead !== PARENT_HEAD_BEFORE) {
      violations.push(
        `inherit-parent-intact: child's HEAD (${childHead}) does not equal the parent's committed tip PARENT_HEAD_BEFORE (${PARENT_HEAD_BEFORE}) — the child did not start exactly where the parent's history ended`,
      );
    }
  }

  let childHasSession = false;
  try {
    await execFileP("tmux", [
      "has-session",
      "-t",
      "=dsp-" + built.identifier + "-2",
    ]);
    childHasSession = true;
  } catch {
    childHasSession = false;
  }
  console.log(
    `inherit-parent-intact: has-session -t "=${childTmuxName}" (no trailing colon) = ${childHasSession}`,
  );
  if (!childHasSession) {
    violations.push(
      `inherit-parent-intact: the child's EXACT tmux session "${childTmuxName}" is not live (has-session -t "=${childTmuxName}" failed)`,
    );
  }

  // --- E. Assert the parent is intact AND answerable. ---
  const PARENT_HEAD_AFTER = (
    await execFileP("git", ["rev-parse", "HEAD"], {
      cwd: built.session1WorktreePath,
    })
  ).stdout.trim();
  const PARENT_PORCELAIN_AFTER = (
    await execFileP("git", ["status", "--porcelain"], {
      cwd: built.session1WorktreePath,
    })
  ).stdout;
  console.log(
    `inherit-parent-intact: PARENT_HEAD_AFTER=${PARENT_HEAD_AFTER}, PARENT_PORCELAIN_AFTER=${JSON.stringify(PARENT_PORCELAIN_AFTER)}`,
  );
  if (PARENT_HEAD_AFTER !== PARENT_HEAD_BEFORE) {
    violations.push(
      `inherit-parent-intact: parent's HEAD changed — before=${PARENT_HEAD_BEFORE} after=${PARENT_HEAD_AFTER}`,
    );
  }
  if (PARENT_PORCELAIN_AFTER !== PARENT_PORCELAIN_BEFORE) {
    violations.push(
      `inherit-parent-intact: parent's \`git status --porcelain\` changed — before=${JSON.stringify(PARENT_PORCELAIN_BEFORE)} after=${JSON.stringify(PARENT_PORCELAIN_AFTER)} (the planted "${plantedFileName}" must still be present and still uncommitted)`,
    );
  }

  let parentHasSession = false;
  try {
    await execFileP("tmux", ["has-session", "-t", "=dsp-" + built.identifier]);
    parentHasSession = true;
  } catch {
    parentHasSession = false;
  }
  console.log(
    `inherit-parent-intact: has-session -t "=${parentTmuxName}" (no trailing colon, EXACT form — a bare target would prefix-match ${childTmuxName}) = ${parentHasSession}`,
  );
  if (!parentHasSession) {
    violations.push(
      `inherit-parent-intact: the parent's EXACT tmux session "${parentTmuxName}" is not live (has-session -t "=${parentTmuxName}" failed) — a bare target here would have prefix-matched the child (${childTmuxName}) and passed while the parent was dead`,
    );
  } else {
    const token =
      "d95-round-trip-" + process.pid + "-" + randomBytes(4).toString("hex");
    await execFileP("tmux", [
      "send-keys",
      "-t",
      "=dsp-" + built.identifier + ":",
      "-l",
      "--",
      "echo " + token,
    ]);
    await execFileP("tmux", [
      "send-keys",
      "-t",
      "=dsp-" + built.identifier + ":",
      "Enter",
    ]);
    const deadline = Date.now() + PROXY_READ_TIMEOUT_MS;
    let found = false;
    let lastPane = "";
    while (Date.now() < deadline) {
      lastPane = (
        await execFileP("tmux", [
          "capture-pane",
          "-p",
          "-t",
          "=dsp-" + built.identifier + ":",
        ])
      ).stdout;
      if (lastPane.includes(token)) {
        found = true;
        break;
      }
      await sleep(POLL_INTERVAL_MS);
    }
    console.log(
      `inherit-parent-intact: parent round trip — send-keys/capture-pane -t "=${parentTmuxName}:" (trailing colon) echoed token "${token}" back = ${found}`,
    );
    if (!found) {
      violations.push(
        `inherit-parent-intact: the parent's exact tmux session "${parentTmuxName}" did NOT answer a real typed round trip within ${PROXY_READ_TIMEOUT_MS}ms — token "${token}" never appeared in its captured pane. This is a FAILURE, not a retry-and-continue. Last captured pane: ${JSON.stringify(lastPane.slice(-2000))}`,
      );
    }
  }

  return violations;
}

/**
 * Poll until a THIRD session has landed. {@link waitForSagaSettled}'s own predicate is
 * `sessionCount >= 2`, which is ALREADY true once session 2 exists — reusing it for session 3
 * would return instantly on the pre-existing state and the check would read the wire before the
 * saga had finished, which is the "settled" reading that is not a settled state.
 */
async function waitForNthSessionSettled(built, n, { timeoutMs }) {
  const deadline = Date.now() + timeoutMs;
  let card;
  while (Date.now() < deadline) {
    card = await fetchFixtureCard(built);
    const settled =
      card != null &&
      card.provisioningStep == null &&
      ((card.sessionCount ?? 1) >= n || card.startError != null);
    if (settled) return { card, timedOut: false };
    await sleep(POLL_INTERVAL_MS);
  }
  return { card, timedOut: true };
}

/**
 * `--check inherit-parentage` (Plan 95-06 Task 1, criterion C3, `MULTI-02`/`UI-03`): proves the
 * parent's id is PERSISTED on the child's record, that the wire reports it as a positional display
 * ordinal, that a session which was never inherited carries NO `parentOrdinal` KEY AT ALL, and that
 * a child whose parent record has been removed degrades to silence on the wire while keeping its
 * recorded provenance.
 *
 * @remarks The measured surface is `GET /api/board`, never the store's in-memory shape: the
 * resolver under test lives in `redactCard`, so an in-memory assertion would measure the wrong
 * layer entirely.
 *
 * @remarks Absence is asserted with `Object.hasOwn`, never with a nullish test. `entry.parentOrdinal
 * == null` passes for `parentOrdinal: undefined` — which is exactly the shape the resolver must not
 * emit — so a nullish test cannot distinguish "reported nothing" from "reported nothing-ness".
 *
 * @remarks THE DEAD-INSTRUMENT TRAP THIS CHECK IS SHAPED AROUND. `redactCard` emits
 * `sessionSummaries` only at `(card.sessions?.length ?? 0) >= 2`. On a TWO-session fixture,
 * removing the parent drops the card to N=1, `sessionSummaries` vanishes entirely, and "session 2
 * has no `parentOrdinal`" is trivially true for a reason that has nothing to do with the resolver's
 * degradation branch — which could be completely absent and this check would still pass. The
 * dangling stage therefore runs on a THREE-session fixture (1, 2-built-from-1, 3-fresh) and asserts
 * the summary COUNT on both sides of the removal — 3 before, 2 after — each with its own named
 * violation, so the N>=2 gate can never be the reason the assertion passes.
 * @see docs/ARCHITECTURE.md#session-inheritance
 */
async function checkInheritParentage(built) {
  const violations = [];
  const session1Id = built.sessionA.id;

  // --- STAGE 1: a REAL inherited start records the parent and reports it as an ordinal. ---
  const { status, body } = await startSecondSession(built, {
    newSession: true,
    inheritFrom: session1Id,
  });
  console.log(
    `inherit-parentage: POST /start {newSession:true, inheritFrom:${session1Id}} -> ${status}`,
  );
  if (status !== 202) {
    violations.push(
      `inherit-parentage: POST /start returned ${status}, expected 202 (body=${JSON.stringify(body)})`,
    );
    return violations;
  }
  const settled2 = await waitForSagaSettled(built, {
    timeoutMs: SECOND_SESSION_SAGA_TIMEOUT_MS,
  });
  if (settled2.timedOut) {
    violations.push(
      `inherit-parentage: session 2's saga did not settle within ${SECOND_SESSION_SAGA_TIMEOUT_MS}ms (last observed card=${JSON.stringify(settled2.card)})`,
    );
    return violations;
  }
  if (settled2.card?.startError != null) {
    violations.push(
      `inherit-parentage: session 2's saga recorded a startError instead of an inherited session: ${JSON.stringify(settled2.card.startError)}`,
    );
    return violations;
  }
  const session2Id = (settled2.card?.sessionSummaries ?? [])
    .map((s) => s.id)
    .find((id) => id !== session1Id);
  if (!session2Id) {
    violations.push(
      `inherit-parentage: could not resolve session 2's id from sessionSummaries=${JSON.stringify(settled2.card?.sessionSummaries)}`,
    );
    return violations;
  }

  const persistedAfter2 = readCard(built.dbPath, built.cardId);
  const record2 = persistedAfter2?.sessions?.find((s) => s.id === session2Id);
  console.log(
    `inherit-parentage: PERSISTED session 2 (${session2Id}) builtFrom = ${JSON.stringify(record2?.builtFrom)} (expected session 1's id ${session1Id})`,
  );
  if (record2?.builtFrom !== session1Id) {
    violations.push(
      `inherit-parentage: the PERSISTED record for session 2 (${session2Id}) has builtFrom=${JSON.stringify(record2?.builtFrom)}, expected session 1's id ${session1Id} — the parent's id was not recorded on the child`,
    );
  }

  const wire1Text = await (
    await fetch(`http://127.0.0.1:${built.port}/api/board`)
  ).text();
  const wire1 = {
    text: wire1Text,
    card: (JSON.parse(wire1Text)?.cards ?? []).find(
      (c) => c.id === built.cardId,
    ),
  };
  const summaries1 = wire1.card?.sessionSummaries ?? [];
  const sum2 = summaries1.find((s) => s.id === session2Id);
  const sum1 = summaries1.find((s) => s.id === session1Id);
  console.log(
    `inherit-parentage: WIRE after session 2 — ${summaries1.length} summaries; session 2 entry=${JSON.stringify(sum2)}; session 1 entry=${JSON.stringify(sum1)}`,
  );
  if (sum2 == null || sum1 == null) {
    violations.push(
      `inherit-parentage: the wire did not carry both sessions in sessionSummaries (session1=${JSON.stringify(sum1)}, session2=${JSON.stringify(sum2)}) — nothing downstream can be asserted`,
    );
    return violations;
  }
  if (sum2.parentOrdinal !== 1) {
    violations.push(
      `inherit-parentage: session 2 (${session2Id}) reports parentOrdinal=${JSON.stringify(sum2.parentOrdinal)}, expected the display ordinal 1 (session 1 is the first entry when sorted by createdAt) — offending JSON fragment: ${JSON.stringify(sum2)}`,
    );
  }
  if (Object.hasOwn(sum1, "parentOrdinal")) {
    violations.push(
      `inherit-parentage: session 1 (${session1Id}) was never inherited, yet its wire entry CARRIES a parentOrdinal key (Object.hasOwn === true, value=${JSON.stringify(sum1.parentOrdinal)}) — a session with no parent must report nothing at all, not nothing-ness — offending JSON fragment: ${JSON.stringify(sum1)}`,
    );
  }
  const nullOrdinalCount = (wire1.text.match(/"parentOrdinal":null/g) ?? [])
    .length;
  const undefinedOrdinalCount = (
    wire1.text.match(/parentOrdinal":undefined/g) ?? []
  ).length;
  console.log(
    `inherit-parentage: raw board body occurrences — '"parentOrdinal":null'=${nullOrdinalCount}, 'parentOrdinal":undefined'=${undefinedOrdinalCount}`,
  );
  if (nullOrdinalCount > 0 || undefinedOrdinalCount > 0) {
    violations.push(
      `inherit-parentage: the raw board body serialises an EMPTY parentOrdinal ('"parentOrdinal":null' x${nullOrdinalCount}, 'parentOrdinal":undefined' x${undefinedOrdinalCount}) — the resolver must omit the key by explicit branch, never emit it holding nothing`,
    );
  }

  // --- STAGE 2: a THIRD, non-inherited session, so the dangling assertion can mean something. ---
  const third = await startSecondSession(built, { newSession: true });
  console.log(
    `inherit-parentage: POST /start {newSession:true} (no inheritFrom) -> ${third.status}`,
  );
  if (third.status !== 202) {
    violations.push(
      `inherit-parentage: the third (non-inherited) POST /start returned ${third.status}, expected 202 (body=${JSON.stringify(third.body)}) — the three-session fixture the dangling assertion requires could not be built`,
    );
    return violations;
  }
  const settled3 = await waitForNthSessionSettled(built, 3, {
    timeoutMs: SECOND_SESSION_SAGA_TIMEOUT_MS,
  });
  if (settled3.timedOut) {
    violations.push(
      `inherit-parentage: session 3's saga did not settle within ${SECOND_SESSION_SAGA_TIMEOUT_MS}ms (last observed card=${JSON.stringify(settled3.card)})`,
    );
    return violations;
  }
  if (settled3.card?.startError != null) {
    violations.push(
      `inherit-parentage: session 3's saga recorded a startError: ${JSON.stringify(settled3.card.startError)}`,
    );
    return violations;
  }
  const session3Id = (settled3.card?.sessionSummaries ?? [])
    .map((s) => s.id)
    .find((id) => id !== session1Id && id !== session2Id);
  if (!session3Id) {
    violations.push(
      `inherit-parentage: could not resolve session 3's id from sessionSummaries=${JSON.stringify(settled3.card?.sessionSummaries)}`,
    );
    return violations;
  }

  const wirePreText = await (
    await fetch(`http://127.0.0.1:${built.port}/api/board`)
  ).text();
  const wirePre = {
    text: wirePreText,
    card: (JSON.parse(wirePreText)?.cards ?? []).find(
      (c) => c.id === built.cardId,
    ),
  };
  const summariesPre = wirePre.card?.sessionSummaries ?? [];
  const preSum2 = summariesPre.find((s) => s.id === session2Id);
  const preSum3 = summariesPre.find((s) => s.id === session3Id);
  console.log(
    `inherit-parentage: PRE-REMOVAL WIRE — ${summariesPre.length} summaries; session 2=${JSON.stringify(preSum2)}; session 3=${JSON.stringify(preSum3)}`,
  );
  if (summariesPre.length !== 3) {
    violations.push(
      `inherit-parentage: THIS CHECK WOULD BE VACUOUS — expected exactly 3 sessionSummaries before the parent is removed, found ${summariesPre.length}. The dangling assertion only means something on a fixture that stays ABOVE redactCard's N>=2 gate after the removal; below it, sessionSummaries disappears entirely and "session 2 has no parentOrdinal" is true for a reason unrelated to the resolver. Refusing to run the degradation assertion. Summaries: ${JSON.stringify(summariesPre)}`,
    );
    return violations;
  }
  if (preSum2?.parentOrdinal !== 1) {
    violations.push(
      `inherit-parentage: before the removal, session 2 (${session2Id}) reports parentOrdinal=${JSON.stringify(preSum2?.parentOrdinal)}, expected 1 — the post-removal delta would not be attributable — offending JSON fragment: ${JSON.stringify(preSum2)}`,
    );
    return violations;
  }
  if (preSum3 == null || Object.hasOwn(preSum3, "parentOrdinal")) {
    violations.push(
      `inherit-parentage: session 3 (${session3Id}) was started with NO inheritFrom, yet its wire entry carries a parentOrdinal key (Object.hasOwn === ${preSum3 == null ? "n/a — entry missing" : "true"}) — offending JSON fragment: ${JSON.stringify(preSum3)}`,
    );
  }

  // --- STAGE 2b: remove the parent's RECORD with the server down, then re-read the wire. ---
  await killAndWait(built.server?.child);
  const serverGone = await waitForServerGone(
    built.port,
    LISTEN_POLL_TIMEOUT_MS,
  );
  console.log(
    `inherit-parentage: sandbox server on :${built.port} stopped before the persisted edit — refused=${serverGone}`,
  );
  if (!serverGone) {
    violations.push(
      `inherit-parentage: the sandbox server on :${built.port} still answers GET /api/board after kill — editing the persisted card now would be raced by a live server re-persisting over it`,
    );
    return violations;
  }

  const cardForEdit = readCard(built.dbPath, built.cardId);
  const survivingSessions = (cardForEdit?.sessions ?? []).filter(
    (s) => s.id !== session1Id,
  );
  if (cardForEdit == null || survivingSessions.length !== 2) {
    violations.push(
      `inherit-parentage: expected exactly 2 sessions to survive removing session 1, found ${survivingSessions.length} (persisted sessions=${JSON.stringify((cardForEdit?.sessions ?? []).map((s) => s.id))})`,
    );
    return violations;
  }
  const priorActive = cardForEdit.activeSessionId;
  cardForEdit.sessions = survivingSessions;
  if (!survivingSessions.some((s) => s.id === cardForEdit.activeSessionId)) {
    const promoted = survivingSessions.find((s) => s.id === session3Id);
    cardForEdit.activeSessionId = promoted.id;
    cardForEdit.tmuxSession = promoted.tmuxSession;
    cardForEdit.ttydPort = promoted.ttydPort;
    cardForEdit.hookToken = promoted.hookToken;
    cardForEdit.workspacePath = promoted.workspacePath;
    cardForEdit.workspace = promoted.workspace;
    cardForEdit.branch = promoted.branch;
  }
  console.log(
    `inherit-parentage: removing session 1's (${session1Id}) record while the server is down; activeSessionId ${priorActive} -> ${cardForEdit.activeSessionId}; session 2's builtFrom left UNCHANGED at ${JSON.stringify(survivingSessions.find((s) => s.id === session2Id)?.builtFrom)}`,
  );
  seedFixtureCard(built.home, cardForEdit);

  built.server = bootServer(built.home, { pathPrefix: built.pathPrefix });
  await waitForReady(built.port);
  console.log(
    `inherit-parentage: sandbox server rebooted on :${built.port} against the edited board`,
  );

  const wirePostText = await (
    await fetch(`http://127.0.0.1:${built.port}/api/board`)
  ).text();
  const wirePost = {
    text: wirePostText,
    card: (JSON.parse(wirePostText)?.cards ?? []).find(
      (c) => c.id === built.cardId,
    ),
  };
  const summariesPost = wirePost.card?.sessionSummaries ?? [];
  const postSum2 = summariesPost.find((s) => s.id === session2Id);
  console.log(
    `inherit-parentage: POST-REMOVAL WIRE — ${summariesPost.length} summaries; session 2=${JSON.stringify(postSum2)}`,
  );
  if (summariesPost.length !== 2) {
    violations.push(
      `inherit-parentage: THIS CHECK WOULD BE VACUOUS — expected exactly 2 sessionSummaries after removing the parent, found ${summariesPost.length}. At fewer than 2, redactCard emits no sessionSummaries at all and the absent parentOrdinal below would prove nothing about the resolver's degradation branch. Summaries: ${JSON.stringify(summariesPost)}`,
    );
    return violations;
  }
  if (postSum2 == null) {
    violations.push(
      `inherit-parentage: session 2 (${session2Id}) is missing from the wire entirely after its parent's record was removed — removing a PARENT must not remove the CHILD`,
    );
    return violations;
  }
  if (Object.hasOwn(postSum2, "parentOrdinal")) {
    violations.push(
      `inherit-parentage: session 2 (${session2Id})'s parent record no longer exists, yet its wire entry STILL carries a parentOrdinal key (Object.hasOwn === true, value=${JSON.stringify(postSum2.parentOrdinal)}) — an unresolvable parent must yield ABSENCE by explicit branch — offending JSON fragment: ${JSON.stringify(postSum2)}`,
    );
  }
  const fromUndefinedCount = (wirePost.text.match(/from undefined/g) ?? [])
    .length;
  const postSum2Text = JSON.stringify(postSum2);
  console.log(
    `inherit-parentage: raw post-removal body — 'from undefined' x${fromUndefinedCount}; session 2 fragment carries "parentOrdinal" = ${postSum2Text.includes("parentOrdinal")}`,
  );
  if (fromUndefinedCount > 0) {
    violations.push(
      `inherit-parentage: the raw post-removal board body contains "from undefined" x${fromUndefinedCount} — a dangling parent must degrade to silence, never to a rendered placeholder`,
    );
  }
  if (postSum2Text.includes("parentOrdinal")) {
    violations.push(
      `inherit-parentage: session 2 (${session2Id})'s own serialised wire fragment still mentions parentOrdinal after the parent was removed: ${postSum2Text}`,
    );
  }

  const persistedPost = readCard(built.dbPath, built.cardId);
  const record2Post = persistedPost?.sessions?.find((s) => s.id === session2Id);
  console.log(
    `inherit-parentage: PERSISTED session 2 after the removal — builtFrom = ${JSON.stringify(record2Post?.builtFrom)} (must STILL be session 1's id ${session1Id})`,
  );
  if (record2Post?.builtFrom !== session1Id) {
    violations.push(
      `inherit-parentage: session 2 (${session2Id})'s persisted builtFrom is ${JSON.stringify(record2Post?.builtFrom)} after its parent's record was removed, expected it to STILL be ${session1Id} — the RENDERING degrades, the RECORD does not; provenance stays true even once the parent is gone`,
    );
  }

  return violations;
}

/**
 * The `builtFrom` read sites this codebase is allowed to have, hardcoded so a NEW read fails this
 * census rather than being absorbed silently. Counts are EXACT-WORD occurrences after comments are
 * stripped: `board.store.ts` carries three (the resolver's null-guard and its lookup on the SAME
 * line, plus `reserveNewSession`'s mint patch), `types.ts` carries the declaration.
 * @remarks `builtFromBranch` (`steps.ts`, `kickoff.ts`) merely CONTAINS this substring and is a
 * different field entirely — a branch name, not a session id. The exact-word matcher below excludes
 * it by construction; a bare substring `grep` would count four extra sites and make this list wrong
 * on the day it was written.
 */
const BUILT_FROM_EXPECTED_SITES = {
  "src/server/store/board.store.ts": 3,
  "src/shared/types.ts": 1,
};

/** Every `.ts`/`.tsx` file under `dir`, recursively. */
function collectSourceFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collectSourceFiles(full, out);
    else if (/\.tsx?$/.test(full)) out.push(full);
  }
  return out;
}

/**
 * The no-transitive-traversal census (Plan 95-06 Task 2, decision `D-C`): re-read `src/` FRESH from
 * disk, strip every comment, and enumerate exact-word `builtFrom` occurrences.
 *
 * @remarks Comments are stripped before counting because this codebase's own JSDoc DESCRIBES the
 * one-hop rule in prose — an unfiltered `grep -c` would count that prose and make the gate
 * self-satisfying, the trap `93-07-PLAN.md` named and this file's `cleanup.ts` census already
 * guards against.
 *
 * @remarks MISSING-SUBJECT SENTINEL. An empty result is a FAILURE, not a pass: if
 * `board.store.ts` contributes zero sites the field has been renamed or moved, and a census that
 * reported "no unexpected sites" in that state would be reporting on nothing at all.
 *
 * @remarks THE CHAINED-READ DETECTOR, and its stated limit. The literal rule "no line contains
 * `builtFrom` twice" is NOT usable here: `board.store.ts`'s shipped, CORRECT resolver line carries
 * it twice (`s.builtFrom != null ? displayOrdinalById.get(s.builtFrom)`) — a null-guard and a
 * lookup on the SAME receiver, which is one hop, not two. The detector below therefore compares the
 * RECEIVER of each occurrence: repeated reads off one identifier are one hop; a second read whose
 * receiver is a call/index RESULT (`).builtFrom`) is a resolve-then-read, which is precisely the
 * arbitrary-depth traversal `D-C` deferred. A `builtFrom` navigated INTO (`.builtFrom.` /
 * `.builtFrom?.`) is flagged unconditionally.
 * This is a per-LINE textual detector: a chain split across two statements is invisible to it. That
 * is why `checkInheritDepth`'s behavioural assertions (session 3's stored parent, and its
 * `parentOrdinal`) are the primary detector and this census is the second, independent one.
 */
function enumerateBuiltFromReadsFromSource() {
  const violations = [];
  const wordRe = /(?<![A-Za-z0-9_$])builtFrom(?![A-Za-z0-9_$])/g;
  const sites = [];
  const countsByFile = {};

  for (const file of collectSourceFiles(join(REPO_ROOT, "src"))) {
    const rel = file.slice(REPO_ROOT.length + 1);
    const strippedLines = stripCommentsPerLine(readFileSync(file, "utf8"));
    strippedLines.forEach((line, idx) => {
      const matches = [...line.matchAll(wordRe)];
      if (matches.length === 0) return;
      countsByFile[rel] = (countsByFile[rel] ?? 0) + matches.length;
      sites.push({
        rel,
        line: idx + 1,
        count: matches.length,
        raw: line,
        text: line.trim(),
        matches,
      });
    });
  }

  console.log(
    `inherit-depth: CENSUS — parsed ${Object.keys(countsByFile).length} file(s) with exact-word ` +
      `\`builtFrom\` (comments stripped): ` +
      sites.map((s) => `${s.rel}:${s.line} x${s.count}`).join(", "),
  );

  // MISSING-SUBJECT SENTINEL — an empty subject must fail, never pass.
  for (const expectedFile of Object.keys(BUILT_FROM_EXPECTED_SITES)) {
    if ((countsByFile[expectedFile] ?? 0) === 0) {
      violations.push(
        `inherit-depth: CENSUS MISSING SUBJECT — expected \`builtFrom\` to appear in ${expectedFile} and it appears ZERO times. The field has been renamed, moved, or deleted; a census that reported "no unexpected read sites" in this state would be reporting on nothing at all, so this is a failure rather than a pass.`,
      );
    }
  }

  for (const [file, expected] of Object.entries(BUILT_FROM_EXPECTED_SITES)) {
    const actual = countsByFile[file] ?? 0;
    if (actual !== 0 && actual !== expected) {
      violations.push(
        `inherit-depth: CENSUS VIOLATED — expected exactly ${expected} exact-word \`builtFrom\` occurrence(s) in ${file}, found ${actual} — a read site was added or removed since this census was written: ${sites
          .filter((s) => s.rel === file)
          .map((s) => `${s.line}:${s.text}`)
          .join(" | ")}`,
      );
    }
  }
  for (const file of Object.keys(countsByFile)) {
    if (!Object.hasOwn(BUILT_FROM_EXPECTED_SITES, file)) {
      violations.push(
        `inherit-depth: CENSUS VIOLATED — \`builtFrom\` is read in ${file}, which is NOT in the expected site list (${Object.keys(BUILT_FROM_EXPECTED_SITES).join(", ")}): ${sites
          .filter((s) => s.rel === file)
          .map((s) => `${s.line}:${s.text}`)
          .join(" | ")}`,
      );
    }
  }

  // The chained-read detector.
  for (const site of sites) {
    const receivers = site.matches.map((m) => {
      const after = site.raw.slice(m.index + "builtFrom".length);
      const navigatedInto = /^\s*(\?\.|\.|\[)/.test(after);
      const before = site.raw.slice(0, m.index);
      const recv = /([A-Za-z0-9_$)\]]+)\s*\??\.\s*$/.exec(before);
      return {
        navigatedInto,
        receiver: recv ? recv[1] : null,
        simple: recv ? /^[A-Za-z0-9_$]+$/.test(recv[1]) : true,
      };
    });
    for (const r of receivers) {
      if (r.navigatedInto) {
        violations.push(
          `inherit-depth: CHAINED READ — ${site.rel}:${site.line} navigates INTO a \`builtFrom\` value (\`builtFrom\` followed by a further dereference): ${site.text}. \`builtFrom\` names the DIRECT parent and is resolved exactly one hop; walking it further is the arbitrary-depth traversal decision \`D-C\` deferred.`,
        );
      }
    }
    if (site.count < 2) continue;
    const distinct = new Set(receivers.map((r) => r.receiver));
    const anyNonSimple = receivers.some((r) => !r.simple);
    if (distinct.size > 1 || anyNonSimple) {
      violations.push(
        `inherit-depth: CHAINED READ — ${site.rel}:${site.line} reads \`builtFrom\` ${site.count} times off ${distinct.size} different receiver(s) (${[...distinct].map((d) => JSON.stringify(d)).join(", ")}${anyNonSimple ? ", at least one of which is a call/index RESULT rather than a plain identifier" : ""}): ${site.text}. Resolving a session BY a \`builtFrom\` value and then reading THAT session's own \`builtFrom\` is precisely the arbitrary-depth traversal decision \`D-C\` deferred; repeated reads off one identifier (a null-guard plus its lookup) are one hop and are allowed.`,
      );
    }
  }

  return violations;
}

/**
 * `--check inherit-depth` (Plan 95-06 Task 2, criterion C4, `MULTI-02`/`UI-03`): proves a session
 * built from an ALREADY-INHERITED session records the session it was actually built from — one hop,
 * never the root — and that nothing in `src/` walks the chain.
 *
 * @remarks Criterion 4 is verified by ATTEMPTING the thing decision `D-C` bounds, because there is
 * no refusal path to test: recording normally was the locked decision, and both flatten-to-root
 * (which records something the user did not do) and refuse-outright (which records no relationship
 * at all, the one thing the criterion says must not happen) were explicitly REJECTED. A non-202 or
 * a `startError` on the second inherited start is therefore itself a violation, not an expected
 * outcome.
 *
 * @remarks Session 2's own commit is PLANTED before session 3 starts, and the plant is guarded:
 * if `S2_TIP === PARENT_TIP` the ancestry statement about session 3 cannot distinguish "cut from
 * session 2" from "cut from session 1", and the check refuses to run rather than report a pass —
 * the same dead-instrument discipline `checkInheritAncestry`'s own `PARENT_TIP === BASE_TIP` guard
 * applies one hop earlier.
 * @see docs/ARCHITECTURE.md#session-inheritance
 */
async function checkInheritDepth(built) {
  const violations = [];
  const session1Id = built.sessionA.id;
  const repoDirName = basename(built.repoPath);

  const PARENT_TIP = (
    await execFileP(
      "git",
      ["rev-parse", "refs/heads/" + built.session1Branch],
      { cwd: built.repoPath },
    )
  ).stdout.trim();

  // --- A1. Hop one: session 2, built from session 1. ---
  const hop1 = await startSecondSession(built, {
    newSession: true,
    inheritFrom: session1Id,
  });
  console.log(
    `inherit-depth: HOP 1 — POST /start {newSession:true, inheritFrom:${session1Id}} -> ${hop1.status}`,
  );
  if (hop1.status !== 202) {
    violations.push(
      `inherit-depth: HOP 1's POST /start returned ${hop1.status}, expected 202 (body=${JSON.stringify(hop1.body)})`,
    );
    return violations;
  }
  const settled2 = await waitForSagaSettled(built, {
    timeoutMs: SECOND_SESSION_SAGA_TIMEOUT_MS,
  });
  if (settled2.timedOut || settled2.card?.startError != null) {
    violations.push(
      `inherit-depth: HOP 1 did not produce a session (timedOut=${settled2.timedOut}, startError=${JSON.stringify(settled2.card?.startError)})`,
    );
    return violations;
  }
  const session2Id = (settled2.card?.sessionSummaries ?? [])
    .map((s) => s.id)
    .find((id) => id !== session1Id);
  if (!session2Id) {
    violations.push(
      `inherit-depth: could not resolve session 2's id from sessionSummaries=${JSON.stringify(settled2.card?.sessionSummaries)}`,
    );
    return violations;
  }
  const session2Branch = built.identifier + "-2";

  // --- A2. PLANT session 2's own commit, and refuse to continue if it did not move the tip. ---
  const session2Record = readCard(built.dbPath, built.cardId)?.sessions?.find(
    (s) => s.id === session2Id,
  );
  const session2WtPath = join(session2Record?.workspacePath ?? "", repoDirName);
  if (!existsSync(session2WtPath)) {
    violations.push(
      `inherit-depth: session 2's worktree does not exist at ${session2WtPath} — cannot plant the commit the ancestry assertion depends on`,
    );
    return violations;
  }
  writeFileSync(
    join(session2WtPath, "session-2-own-work.txt"),
    "committed inside session 2's own worktree, after its start settled\n",
  );
  await execFileP("git", ["add", "session-2-own-work.txt"], {
    cwd: session2WtPath,
  });
  await execFileP(
    "git",
    ["commit", "-m", "fixture session 2 own work", "--no-gpg-sign"],
    { cwd: session2WtPath },
  );
  const S2_TIP = (
    await execFileP("git", ["rev-parse", "refs/heads/" + session2Branch], {
      cwd: built.repoPath,
    })
  ).stdout.trim();
  console.log(
    `inherit-depth: PARENT_TIP (branch ${built.session1Branch}) = ${PARENT_TIP}, S2_TIP (branch ${session2Branch}, after planting session 2's own commit) = ${S2_TIP}`,
  );
  if (S2_TIP === PARENT_TIP) {
    violations.push(
      `inherit-depth: THIS CHECK WOULD BE VACUOUS — session 2's branch "${session2Branch}" (S2_TIP=${S2_TIP}) carries no commit of its own beyond session 1's tip (PARENT_TIP=${PARENT_TIP}); they are the SAME commit even after a commit was planted. Every ancestry statement about session 3 would then be satisfied by a child cut from session 1, so this check refuses to run the hop-2 ancestry assertion and report a pass.`,
    );
    return violations;
  }

  // --- A3. Hop two: session 3, built from the ALREADY-INHERITED session 2. ---
  const hop2 = await startSecondSession(built, {
    newSession: true,
    inheritFrom: session2Id,
  });
  console.log(
    `inherit-depth: HOP 2 — POST /start {newSession:true, inheritFrom:${session2Id}} (an ALREADY-INHERITED parent) -> ${hop2.status}`,
  );
  if (hop2.status !== 202) {
    violations.push(
      `inherit-depth: HOP 2's POST /start returned ${hop2.status}, expected 202 (body=${JSON.stringify(hop2.body)}). Building from an already-inherited session must RECORD NORMALLY — refuse-outright was explicitly REJECTED (it records no relationship at all, the one thing criterion 4 says must not happen), so a refusal here is a violation, not an expected outcome.`,
    );
    return violations;
  }
  const settled3 = await waitForNthSessionSettled(built, 3, {
    timeoutMs: SECOND_SESSION_SAGA_TIMEOUT_MS,
  });
  if (settled3.timedOut) {
    violations.push(
      `inherit-depth: HOP 2's saga did not settle within ${SECOND_SESSION_SAGA_TIMEOUT_MS}ms (last observed card=${JSON.stringify(settled3.card)})`,
    );
    return violations;
  }
  if (settled3.card?.startError != null) {
    violations.push(
      `inherit-depth: HOP 2 recorded a startError: ${JSON.stringify(settled3.card.startError)}. Building from an already-inherited session must succeed and record normally — refuse-outright was explicitly REJECTED, so this is a violation rather than an expected refusal.`,
    );
    return violations;
  }
  const session3Id = (settled3.card?.sessionSummaries ?? [])
    .map((s) => s.id)
    .find((id) => id !== session1Id && id !== session2Id);
  if (!session3Id) {
    violations.push(
      `inherit-depth: could not resolve session 3's id from sessionSummaries=${JSON.stringify(settled3.card?.sessionSummaries)}`,
    );
    return violations;
  }
  const session3Branch = built.identifier + "-3";
  console.log(
    `inherit-depth: chain — session 1=${session1Id} (${built.session1Branch}), session 2=${session2Id} (${session2Branch}), session 3=${session3Id} (${session3Branch})`,
  );

  // --- B. The stored shape: one hop, naming the session the user actually built from. ---
  const persisted = readCard(built.dbPath, built.cardId);
  const record2 = persisted?.sessions?.find((s) => s.id === session2Id);
  const record3 = persisted?.sessions?.find((s) => s.id === session3Id);
  console.log(
    `inherit-depth: PERSISTED — session 2 builtFrom=${JSON.stringify(record2?.builtFrom)} (expected session 1 ${session1Id}); session 3 builtFrom=${JSON.stringify(record3?.builtFrom)} (expected session 2 ${session2Id})`,
  );
  if (record3 == null) {
    violations.push(
      `inherit-depth: session 3 (${session3Id}) has no persisted record at all`,
    );
    return violations;
  }
  if (!Object.hasOwn(record3, "builtFrom")) {
    violations.push(
      `inherit-depth: session 3 (${session3Id}) carries NO builtFrom key at all (Object.hasOwn === false) — it was built from session 2 and must record that; recording no relationship is the one outcome criterion 4 forbids. Record: ${JSON.stringify(record3)}`,
    );
  }
  if (record3.builtFrom !== session2Id) {
    violations.push(
      `inherit-depth: session 3 (${session3Id})'s builtFrom is ${JSON.stringify(record3.builtFrom)}, expected session 2's id ${session2Id} — builtFrom always names the DIRECT parent, the session the user actually built from`,
    );
  }
  if (record3.builtFrom === session1Id) {
    violations.push(
      `inherit-depth: FLATTEN-TO-ROOT — session 3 (${session3Id})'s builtFrom is session 1's id ${session1Id}, but the user built it from session 2 (${session2Id}). Flatten-to-root was explicitly REJECTED: it records something the user did not do.`,
    );
  }
  if (record2?.builtFrom !== session1Id) {
    violations.push(
      `inherit-depth: session 2 (${session2Id})'s builtFrom is ${JSON.stringify(record2?.builtFrom)}, expected session 1's id ${session1Id} — the chain must stay intact at BOTH hops, not only the newest one`,
    );
  }

  // --- C. The wire shape: session 3 reporting 1 is the visible signature of a flatten bug. ---
  const wireText = await (
    await fetch(`http://127.0.0.1:${built.port}/api/board`)
  ).text();
  const wireCard = (JSON.parse(wireText)?.cards ?? []).find(
    (c) => c.id === built.cardId,
  );
  const summaries = wireCard?.sessionSummaries ?? [];
  const sum2 = summaries.find((s) => s.id === session2Id);
  const sum3 = summaries.find((s) => s.id === session3Id);
  console.log(
    `inherit-depth: WIRE — ${summaries.length} summaries; session 2=${JSON.stringify(sum2)}; session 3=${JSON.stringify(sum3)}`,
  );
  if (sum3?.parentOrdinal !== 2) {
    violations.push(
      `inherit-depth: session 3 (${session3Id}) reports parentOrdinal=${JSON.stringify(sum3?.parentOrdinal)}, expected 2 (session 2's own display ordinal)${sum3?.parentOrdinal === 1 ? " — reporting 1 is the VISIBLE SIGNATURE of a flatten-to-root bug: the wire is naming the root instead of the direct parent" : ""} — offending JSON fragment: ${JSON.stringify(sum3)}`,
    );
  }
  if (sum2?.parentOrdinal !== 1) {
    violations.push(
      `inherit-depth: session 2 (${session2Id}) reports parentOrdinal=${JSON.stringify(sum2?.parentOrdinal)}, expected 1 — offending JSON fragment: ${JSON.stringify(sum2)}`,
    );
  }

  // --- D. The git shape at BOTH hops — the fan-out direction, not merely the field. ---
  for (const hop of [
    { label: "HOP 1", tip: PARENT_TIP, branch: session2Branch },
    { label: "HOP 2", tip: S2_TIP, branch: session3Branch },
  ]) {
    let ancestorExitsZero = true;
    try {
      await execFileP(
        "git",
        ["merge-base", "--is-ancestor", hop.tip, hop.branch],
        { cwd: built.repoPath },
      );
    } catch (err) {
      ancestorExitsZero = false;
      violations.push(
        `inherit-depth: ${hop.label} — "git merge-base --is-ancestor ${hop.tip} ${hop.branch}" did not exit 0: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const revListShas = (
      await execFileP("git", ["rev-list", hop.branch], { cwd: built.repoPath })
    ).stdout
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    const contains = revListShas.includes(hop.tip);
    console.log(
      `inherit-depth: ${hop.label} — is-ancestor(${hop.tip}, ${hop.branch}) exits 0 = ${ancestorExitsZero}; git rev-list ${hop.branch} contains it = ${contains} (${revListShas.length} commits)`,
    );
    if (!contains) {
      violations.push(
        `inherit-depth: ${hop.label} — "git rev-list ${hop.branch}" does NOT literally contain the named sha ${hop.tip} — the assertion the bare is-ancestor exit code alone cannot prove (rev-list output: ${JSON.stringify(revListShas)})`,
      );
    }
  }

  // --- E. The no-transitive-traversal source census. ---
  violations.push(...enumerateBuiltFromReadsFromSource());

  return violations;
}

/** `GET /api/cards/:id` — the single-card fetch, `{ card, members }`, `members` populated only for `source: "group"`. */
async function fetchCardById(built, id) {
  const res = await fetch(`http://127.0.0.1:${built.port}/api/cards/${id}`);
  const body = await res.json().catch(() => undefined);
  return { status: res.status, body };
}

/**
 * `--check parity-fixture` (Plan 96-03, Phase 96 Wave 0): proves {@link PARITY_FIXTURE} and
 * {@link GROUP_SESSION_FIXTURE} each stand up and tear down against a real server the way they
 * claim to, following {@link checkSecondStartRollback}'s own two-`withFixture`-calls-in-one-check
 * shape — this is not a `KEEP-02`/`KEEP-03` verdict check itself (those are later plans' own
 * `--check` modes measured against these two profiles), only the fixtures' own self-proof.
 */
async function checkParityFixture() {
  const violations = [];
  violations.push(
    ...(await withFixture(
      "parity-fixture-n1",
      checkParityFixtureN1,
      PARITY_FIXTURE,
    )),
  );
  violations.push(
    ...(await withFixture(
      "parity-fixture-group",
      checkParityFixtureGroup,
      GROUP_SESSION_FIXTURE,
    )),
  );
  return violations;
}

/**
 * The {@link PARITY_FIXTURE} half of `--check parity-fixture`: the card owns exactly one real
 * session brought up entirely through the real first-start saga, a real ttyd answers it, a real
 * git worktree is registered for it, and the wire payload carries neither `sessionCount` nor
 * `sessionSummaries` — read via `Object.hasOwn`, never a nullish test (`T-96-09`,
 * `95-06`'s own finding restated as an acceptance criterion here): `JSON.stringify` drops an
 * `undefined`-valued key entirely, so only `Object.hasOwn` can distinguish "genuinely absent" from
 * "present and undefined".
 */
async function checkParityFixtureN1(built) {
  const violations = [];

  const persisted = readCard(built.dbPath, built.cardId);
  const sessionCount = persisted?.sessions?.length ?? 0;
  if (sessionCount !== 1) {
    violations.push(
      `parity-fixture-n1: persisted card owns ${sessionCount} session(s), expected exactly 1 (sessions=${JSON.stringify(persisted?.sessions)})`,
    );
  }

  const expectedTmux = `dsp-${built.identifier}`;
  if (built.tmux.a !== expectedTmux) {
    violations.push(
      `parity-fixture-n1: session 1's recorded tmux name ${built.tmux.a} !== the unsuffixed expected name ${expectedTmux}`,
    );
  }
  const live = await tmuxListSessionNames();
  if (!live.includes(expectedTmux)) {
    violations.push(
      `parity-fixture-n1: session 1's tmux name ${expectedTmux} is not a real LIVE tmux session: ${JSON.stringify(live)}`,
    );
  }
  console.log(
    `parity-fixture-n1: session count=${sessionCount}, tmux=${built.tmux.a} (live=${live.includes(expectedTmux)})`,
  );

  if (built.sessionA?.id == null) {
    violations.push(
      `parity-fixture-n1: could not resolve session 1's id from the settled saga — cannot bring its terminal up`,
    );
    return violations;
  }
  const readyResult = await ensureSessionTerminalReady(
    built,
    built.sessionA.id,
  );
  if (!readyResult.ok) {
    violations.push(
      `parity-fixture-n1: could not bring session 1's terminal up — ${readyResult.reason}`,
    );
  } else {
    const marker = `parity-n1-${randomBytes(4).toString("hex")}`;
    await writePaneMarker(built.tmux.a, built.home, marker);
    const read = await readPaneThroughProxy({
      port: built.port,
      idSegment: built.sessionA.id,
      expect: marker,
      timeoutMs: PROXY_READ_TIMEOUT_MS,
    });
    console.log(
      `parity-fixture-n1: real ttyd answered through the proxy — found marker=${read.text.includes(marker)}`,
    );
    if (!read.text.includes(marker)) {
      violations.push(
        `parity-fixture-n1: real ttyd did not echo marker "${marker}" through the proxy`,
      );
    }
  }

  const registered = await gitWorktreeListRegistered(built.repoPath);
  const wtRealpath = existsSync(built.session1WorktreePath)
    ? realpathSync(built.session1WorktreePath)
    : built.session1WorktreePath;
  if (!registered.has(wtRealpath)) {
    violations.push(
      `parity-fixture-n1: session 1 worktree not registered in \`git worktree list\`: ${built.session1WorktreePath} (registered=${[...registered].join(", ")})`,
    );
  }
  console.log(
    `parity-fixture-n1: worktree registered=${registered.has(wtRealpath)} — ${built.session1WorktreePath}`,
  );

  const wireCard = await fetchFixtureCard(built);
  if (wireCard == null) {
    violations.push(
      `parity-fixture-n1: card ${built.cardId} not found on GET /api/board`,
    );
    return violations;
  }
  if (Object.hasOwn(wireCard, "sessionCount")) {
    violations.push(
      `parity-fixture-n1: wire card carries "sessionCount" (${JSON.stringify(wireCard.sessionCount)}) at N=1 — must be ABSENT, not merely falsy`,
    );
  }
  if (Object.hasOwn(wireCard, "sessionSummaries")) {
    violations.push(
      `parity-fixture-n1: wire card carries "sessionSummaries" (${JSON.stringify(wireCard.sessionSummaries)}) at N=1 — must be ABSENT, not merely falsy`,
    );
  }
  console.log(
    `parity-fixture-n1: wire card hasOwn(sessionCount)=${Object.hasOwn(wireCard, "sessionCount")} hasOwn(sessionSummaries)=${Object.hasOwn(wireCard, "sessionSummaries")}`,
  );

  return violations;
}

/**
 * The {@link GROUP_SESSION_FIXTURE} half of `--check parity-fixture`: the parent owns >= 2 real
 * sessions AND is linked to both member cards through the server's OWN `membersOf` (read via a
 * real `GET /cards/:id`, never by re-reading the seed object — `T-96-08`), and the parent's wire
 * payload DOES carry `sessionCount` >= 2 (the multi-session shape and the members concept
 * genuinely coexisting, `96-RESEARCH.md` Pitfall 3).
 */
async function checkParityFixtureGroup(built) {
  const violations = [];

  const persisted = readCard(built.dbPath, built.cardId);
  const sessionCount = persisted?.sessions?.length ?? 0;
  if (sessionCount < 2) {
    violations.push(
      `parity-fixture-group: parent owns ${sessionCount} session(s), expected >= 2 (sessions=${JSON.stringify(persisted?.sessions)})`,
    );
  }

  const { status, body } = await fetchCardById(built, built.cardId);
  if (status !== 200) {
    violations.push(
      `parity-fixture-group: GET /cards/${built.cardId} -> ${status}, expected 200 (body=${JSON.stringify(body)})`,
    );
    return violations;
  }
  const memberIds = (body?.members ?? []).map((m) => m.id).sort();
  const expectedIds = [built.memberAId, built.memberBId].sort();
  console.log(
    `parity-fixture-group: GET /cards/${built.cardId} -> 200, real membersOf() returned ids=${JSON.stringify(memberIds)}`,
  );
  if (JSON.stringify(memberIds) !== JSON.stringify(expectedIds)) {
    violations.push(
      `parity-fixture-group: real membersOf() returned ${JSON.stringify(memberIds)}, expected exactly ${JSON.stringify(expectedIds)}`,
    );
  }

  const wireCard = await fetchFixtureCard(built);
  if (wireCard == null) {
    violations.push(
      `parity-fixture-group: card ${built.cardId} not found on GET /api/board`,
    );
    return violations;
  }
  const wireSessionCount = wireCard.sessionCount;
  console.log(
    `parity-fixture-group: wire card sessionCount=${JSON.stringify(wireSessionCount)}`,
  );
  if (!(Object.hasOwn(wireCard, "sessionCount") && wireSessionCount >= 2)) {
    violations.push(
      `parity-fixture-group: wire card must carry "sessionCount" >= 2 at N>=2, got ${JSON.stringify(wireSessionCount)} (hasOwn=${Object.hasOwn(wireCard, "sessionCount")})`,
    );
  }

  return violations;
}

/**
 * Create a SECOND, throwaway sessionless card via the real `POST /cards` local-card route — never
 * {@link seedFixtureCard}'s raw `node:sqlite` insert, which writes to disk but is invisible to the
 * ALREADY-BOOTED sandbox server's in-memory store (a live server never re-reads `board.db` after
 * its own `load()`; a row inserted after boot is real on disk yet the running route handler
 * reports `unknown card id`, live-caught by this row's own first draft). `store.createLocalCard`
 * mints a fresh `LOCAL-<n>` identifier itself (matches the `/start` route's own ticket-identifier
 * regex) and returns `column: "todo"`, no workspace — the START request itself carries the
 * workspace payload (`folder`/`repos`, `cards.route.ts`'s `hasWorkspacePayload` branch) reusing
 * {@link PARITY_FIXTURE}'s own already-seeded throwaway repo, since no `store.setCardWorkspace`
 * call is reachable from outside the process. Row 1's rollback leg needs this SECOND card because
 * {@link PARITY_FIXTURE}'s own card already carries a real, settled session 1 by the time any
 * check runs (its stand-up drives the happy path) — forcing a FIRST-start saga to fail needs a
 * card no prior stand-up step has touched.
 */
async function createRollbackStartCard(built) {
  const res = await fetch(`http://127.0.0.1:${built.port}/api/cards`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title: "session-liveness-v3 parity-lifecycle row 1 rollback card",
      description:
        "throwaway sessionless card for row 1's forced-failure rollback leg",
    }),
  });
  const body = await res.json().catch(() => undefined);
  if (res.status !== 201 || body?.identifier == null) {
    throw new Error(
      `row 1 start (rollback): POST /cards to create the throwaway rollback card failed — status=${res.status} body=${JSON.stringify(body)}`,
    );
  }
  return { cardId: body.id, identifier: body.identifier };
}

/**
 * POST the real `/api/cards/:id/start` route against an ARBITRARY card id — row 1's rollback leg
 * needs this because {@link startSecondSession} is hardcoded onto `built.cardId`
 * ({@link PARITY_FIXTURE}'s own card), never the throwaway rollback card
 * {@link createRollbackStartCard} mints.
 */
async function postStartForCard(built, cardId, body) {
  const res = await fetch(
    `http://127.0.0.1:${built.port}/api/cards/${cardId}/start`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  const parsed = await res.json().catch(() => undefined);
  return { status: res.status, body: parsed };
}

/**
 * {@link waitForFirstStartSettled}'s generic counterpart, keyed to an ARBITRARY card id via
 * {@link fetchCardById} rather than {@link fetchFixtureCard}'s hardcoded `built.cardId` — needed
 * because row 1's rollback leg drives the throwaway rollback card
 * {@link createRollbackStartCard} mints, a card {@link PARITY_FIXTURE}'s own stand-up never
 * touches.
 */
/**
 * @remarks Requires an OBSERVED non-null `provisioningStep` tick before ever accepting settlement
 * — row 1's own rollback-then-retry sequence calls this TWICE against the SAME card, and the
 * second call's target already carries a stale `startError` from the first, failed attempt. A
 * naive settle predicate (`provisioningStep == null && (tmuxSession != null || startError !=
 * null)`) would read that STALE state as "already settled" on its very FIRST poll, before the
 * retry's own saga has done anything — reporting the retry's own eventual outcome as whatever the
 * prior attempt already left behind. Seeing a genuine in-flight tick first proves THIS call's own
 * saga actually ran.
 */
async function waitForCardFirstStartSettled(built, cardId, { timeoutMs }) {
  const deadline = Date.now() + timeoutMs;
  let card;
  let sawProvisioning = false;
  while (Date.now() < deadline) {
    const { status, body } = await fetchCardById(built, cardId);
    card = status === 200 ? body?.card : undefined;
    if (card?.provisioningStep != null) sawProvisioning = true;
    const settled =
      card != null &&
      sawProvisioning &&
      card.provisioningStep == null &&
      (card.tmuxSession != null || card.startError != null);
    if (settled) return { card, timedOut: false };
    await sleep(POLL_INTERVAL_MS);
  }
  return { card, timedOut: true };
}

/**
 * `KEEP-02` row 1 (start). {@link PARITY_FIXTURE}'s own stand-up already drove the happy path (one
 * real `POST /cards/:id/start`, no `newSession`) — this reasserts that outcome as the row's OWN
 * named claim (never silently borrowed from `checkParityFixtureN1`'s own self-proof) and adds the
 * two legs that self-proof never exercised: an EXACT-equality bare-unsuffixed-name assertion
 * widened to `branch`/`workspacePath` (not only `tmuxSession`), and the rollback leg — a forced
 * saga failure on a SECOND, throwaway sessionless card ({@link createRollbackStartCard}) returning
 * to its pre-start column with `startError` populated and no live tmux session left behind,
 * followed by a restored-stub re-run of the SAME card's happy path. A start row that never
 * exercises rollback is a row that cannot notice a half-started strand (`T-96-13`'s behavioural
 * leg — the wire-shape leg is `T-96-13`'s named acceptance criterion, proven by this row's own
 * `Object.hasOwn` assertions below and by the `sessionCount`-at-N=1 break in Task 2).
 * @remarks Exact-equality, not a suffix regex: `built.identifier` itself legitimately ends in
 * `-<digits>` (a ticket number, e.g. `ZZ96<pid>-1`), so a trailing-digits pattern would false-flag
 * every correct session — only comparing against the KNOWN bare value distinguishes a real Phase
 * 94 ordinal suffix (`<identifier>-2`) from the ticket number's own trailing digits.
 */
async function checkParityRow1Start(built) {
  const violations = [];

  const persisted = readCard(built.dbPath, built.cardId);
  const sessionCount = persisted?.sessions?.length ?? 0;
  if (sessionCount !== 1) {
    violations.push(
      `row 1 start: persisted card owns ${sessionCount} session(s), expected exactly 1 (sessions=${JSON.stringify(persisted?.sessions)})`,
    );
  }
  const expectedTmux = `dsp-${built.identifier}`;
  const live = await tmuxListSessionNames();
  console.log(
    `row 1 start (happy path): session count=${sessionCount}, tmux=${built.tmux.a} (live=${live.includes(expectedTmux)})`,
  );
  if (built.tmux.a !== expectedTmux || !live.includes(expectedTmux)) {
    violations.push(
      `row 1 start: session 1's tmux name expected the bare unsuffixed "${expectedTmux}", got recorded=${built.tmux.a} live=${JSON.stringify(live)}`,
    );
  }
  const record = persisted?.sessions?.find((s) => s.id === built.sessionA?.id);
  if (record) {
    if (record.branch !== built.identifier) {
      violations.push(
        `row 1 start: session 1's branch expected the bare unsuffixed "${built.identifier}", actual "${record.branch}"`,
      );
    }
    if (record.workspacePath !== built.session1WorkspacePath) {
      violations.push(
        `row 1 start: session 1's workspacePath expected the bare unsuffixed "${built.session1WorkspacePath}", actual "${record.workspacePath}"`,
      );
    }
    console.log(
      `row 1 start (happy path): branch="${record.branch}" workspacePath="${record.workspacePath}" — both expected bare, no ordinal suffix`,
    );
  } else {
    violations.push(
      `row 1 start: session 1 record ${built.sessionA?.id} missing from persisted sessions[] — cannot assert branch/workspacePath bareness`,
    );
  }

  if (built.sessionA?.id != null) {
    const readyResult = await ensureSessionTerminalReady(
      built,
      built.sessionA.id,
    );
    if (!readyResult.ok) {
      violations.push(
        `row 1 start: could not bring session 1's terminal up — ${readyResult.reason}`,
      );
    } else {
      const marker = `row1-${randomBytes(4).toString("hex")}`;
      await writePaneMarker(built.tmux.a, built.home, marker);
      const read = await readPaneThroughProxy({
        port: built.port,
        idSegment: built.sessionA.id,
        expect: marker,
        timeoutMs: PROXY_READ_TIMEOUT_MS,
      });
      console.log(
        `row 1 start (happy path): real ttyd answered through the proxy — found marker=${read.text.includes(marker)}`,
      );
      if (!read.text.includes(marker)) {
        violations.push(
          `row 1 start: real ttyd did not echo marker "${marker}" through the proxy`,
        );
      }
    }
  }

  const registered = await gitWorktreeListRegistered(built.repoPath);
  const wtRealpath = existsSync(built.session1WorktreePath)
    ? realpathSync(built.session1WorktreePath)
    : built.session1WorktreePath;
  console.log(
    `row 1 start (happy path): worktree registered=${registered.has(wtRealpath)} — ${built.session1WorktreePath}`,
  );
  if (!registered.has(wtRealpath)) {
    violations.push(
      `row 1 start: session 1 worktree not registered in \`git worktree list\`: ${built.session1WorktreePath}`,
    );
  }

  const wireCard = await fetchFixtureCard(built);
  if (wireCard == null) {
    violations.push(
      `row 1 start: card ${built.cardId} not found on GET /api/board`,
    );
  } else {
    console.log(
      `row 1 start (happy path): wire card hasOwn(sessionCount)=${Object.hasOwn(wireCard, "sessionCount")} hasOwn(sessionSummaries)=${Object.hasOwn(wireCard, "sessionSummaries")} (both expected false at N=1)`,
    );
    if (Object.hasOwn(wireCard, "sessionCount")) {
      violations.push(
        `row 1 start: wire card carries "sessionCount" (${JSON.stringify(wireCard.sessionCount)}) at N=1 — must be ABSENT, not merely falsy`,
      );
    }
    if (Object.hasOwn(wireCard, "sessionSummaries")) {
      violations.push(
        `row 1 start: wire card carries "sessionSummaries" (${JSON.stringify(wireCard.sessionSummaries)}) at N=1 — must be ABSENT, not merely falsy`,
      );
    }
  }

  const rollbackCard = await createRollbackStartCard(built);
  const rollbackWorkspacePayload = {
    extraDirection: "",
    folder: join(built.home, "repos"),
    repos: [{ path: built.repoPath, base: built.repoBase }],
  };
  const rollbackTmux = `dsp-${rollbackCard.identifier}`;
  try {
    writeExitingStubClaudeBinary(built.home);
    console.log(
      `row 1 start (rollback): created throwaway sessionless card ${rollbackCard.cardId} (identifier ${rollbackCard.identifier}), swapped the stub claude for an exit-immediately variant`,
    );
    const { status: startStatus, body: startBody } = await postStartForCard(
      built,
      rollbackCard.cardId,
      rollbackWorkspacePayload,
    );
    console.log(
      `row 1 start (rollback): POST /start on the throwaway sessionless card -> ${startStatus} (expected 202)`,
    );
    if (startStatus !== 202) {
      violations.push(
        `row 1 start (rollback): POST /start returned ${startStatus}, expected 202 (body=${JSON.stringify(startBody)})`,
      );
    } else {
      const { card: failedCard, timedOut } = await waitForCardFirstStartSettled(
        built,
        rollbackCard.cardId,
        { timeoutMs: RESTART_REPL_TIMEOUT_SETTLE_MS },
      );
      console.log(
        `row 1 start (rollback): forced-failure saga settled — column=${failedCard?.column} (expected "todo"), startError=${JSON.stringify(failedCard?.startError)} (expected populated), tmuxSession=${failedCard?.tmuxSession} (expected absent), timedOut=${timedOut}`,
      );
      if (timedOut) {
        violations.push(
          `row 1 start (rollback): forced-failure saga did not settle within ${RESTART_REPL_TIMEOUT_SETTLE_MS}ms`,
        );
      } else {
        if (failedCard?.column !== "todo") {
          violations.push(
            `row 1 start (rollback): card column expected "todo" (pre-start), actual "${failedCard?.column}" — a failed first start must never strand the card mid-provision`,
          );
        }
        if (failedCard?.startError == null) {
          violations.push(
            "row 1 start (rollback): expected startError populated after the forced failure, got none",
          );
        }
        if (failedCard?.tmuxSession != null) {
          violations.push(
            `row 1 start (rollback): card.tmuxSession expected absent after rollback, got "${failedCard?.tmuxSession}" — a failed start must not leave a half-started session pointer`,
          );
        }
      }
      const liveAfterFail = await tmuxListSessionNames();
      if (liveAfterFail.includes(rollbackTmux)) {
        violations.push(
          `row 1 start (rollback): tmux session ${rollbackTmux} still LIVE after the forced-failure saga's own compensation — a half-started strand`,
        );
      }
    }

    writeStubClaudeBinary(built.home);
    console.log(
      "row 1 start (rollback re-run): restored the working stub claude, re-running the happy path on the same rollback card",
    );
    const { status: retryStatus, body: retryBody } = await postStartForCard(
      built,
      rollbackCard.cardId,
      rollbackWorkspacePayload,
    );
    if (retryStatus !== 202) {
      violations.push(
        `row 1 start (rollback re-run): POST /start returned ${retryStatus}, expected 202 (body=${JSON.stringify(retryBody)})`,
      );
    } else {
      const { card: recovered, timedOut: recoverTimedOut } =
        await waitForCardFirstStartSettled(built, rollbackCard.cardId, {
          timeoutMs: SECOND_SESSION_SAGA_TIMEOUT_MS,
        });
      console.log(
        `row 1 start (rollback re-run): column=${recovered?.column} (expected "in_progress"), tmuxSession=${recovered?.tmuxSession} (expected present), startError=${JSON.stringify(recovered?.startError)} (expected none), timedOut=${recoverTimedOut}`,
      );
      if (
        recoverTimedOut ||
        recovered?.startError != null ||
        recovered?.column !== "in_progress" ||
        recovered?.tmuxSession == null
      ) {
        violations.push(
          `row 1 start (rollback re-run): the restored stub did not recover a genuine start — column=${recovered?.column}, startError=${JSON.stringify(recovered?.startError)}, tmuxSession=${recovered?.tmuxSession} — a prior failed start must never wedge the saga`,
        );
      }
    }
  } finally {
    await tmuxKillSessionExact(rollbackTmux).catch(() => {});
  }

  const verdict =
    violations.length === 0
      ? "PASS"
      : `FAIL (${violations.length} violation(s))`;
  console.log(`ROW 1 start: ${verdict}`);
  return violations;
}

/**
 * `KEEP-02` row 2 (kickoff). Read the pane content the real saga's own `sendKickoff` step already
 * typed into session 1 during {@link PARITY_FIXTURE}'s stand-up, through the real proxy — never a
 * 204 or a settled saga as a stand-in, the exact "reads a constant" dead-instrument shape
 * `.planning/milestones/v2.9-ROADMAP.md` names (dead instrument family #4/#7). `buildKickoff`'s
 * own deterministic head line (`kickoff.ts:217`, `You are working on Linear ticket <identifier>:
 * <title>`) embeds `card.identifier` — {@link PARITY_IDENTIFIER}, unique per harness run — so
 * matching it proves THIS run's real kickoff landed, not a stale pane from an earlier run.
 * @remarks Phase 94's own open residual R2 (bare, unprefixed tmux targets inside `awaitReplReady` /
 * `sendKickoff`) is structurally UNREACHABLE at N=1: there is no live sibling for a broken
 * prefix-match to land on, so this row measures kickoff delivery only — R2's own closure belongs
 * to plan 96-11, stated explicitly in this row's own verdict rather than left for the reader to
 * wonder about.
 */
async function checkParityRow2Kickoff(built) {
  const violations = [];
  if (built.sessionA?.id == null) {
    violations.push(
      "row 2 kickoff: no session 1 id resolved — cannot read its pane",
    );
    console.log(`ROW 2 kickoff: FAIL (${violations.length} violation(s))`);
    return violations;
  }

  const kickoffHeadFragment = `You are working on Linear ticket ${built.identifier}`;
  const read = await readPaneThroughProxy({
    port: built.port,
    idSegment: built.sessionA.id,
    expect: kickoffHeadFragment,
    timeoutMs: PROXY_READ_TIMEOUT_MS,
  });
  console.log(
    `row 2 kickoff: real pane content through the proxy — found kickoff head line=${read.text.includes(kickoffHeadFragment)} (opened=${read.opened})`,
  );
  if (!read.text.includes(kickoffHeadFragment)) {
    violations.push(
      `row 2 kickoff: real pane content did not include the kickoff's own head line "${kickoffHeadFragment}" — the saga's sendKickoff step must not silently fail to deliver`,
    );
  }
  console.log(
    "row 2 kickoff: Phase 94's residual R2 (bare tmux prefix-match hazard in awaitReplReady/sendKickoff) is structurally UNREACHABLE at N=1 — no live sibling exists for a broken prefix match to land on; this row measures kickoff delivery only, R2's own closure is plan 96-11's",
  );

  const verdict =
    violations.length === 0
      ? "PASS"
      : `FAIL (${violations.length} violation(s))`;
  console.log(`ROW 2 kickoff: ${verdict}`);
  return violations;
}

/**
 * `KEEP-02` rows 3 (marker routing), 4 (needs-input flip) and 5 (flip-back), against
 * {@link PARITY_FIXTURE}'s own subject — porting {@link checkSingleSession}'s steps 1/2 assertion
 * shapes (Phase 91.1, PRE-DATING this plan) so the whole six-row checklist reports against ONE
 * card, never re-presenting their coverage as new. `--check single-session` itself is left
 * unmodified (its own fixture, {@link SINGLE_SESSION_FIXTURE}, is a separate card entirely).
 * @remarks Row 3's negative case cannot recreate {@link registerHookToken}'s own ownership-refusal
 * REGISTRATION path with only one card in the sandbox — that guard fires when a session id is
 * registered against a card that does not own it, and every registration this fixture's own boot
 * performs is genuinely self-owned by construction, so there is no way to reach it from outside the
 * process without a second, differently-owned session already live. A garbage, never-registered
 * token is used instead, which exercises the auth GATE ({@link resolveHookToken} returning
 * `undefined`) rather than the registration guard. Both are load-bearing for the identical claim
 * ("a token not naming this session must never be silently accepted"); this substitution, and why
 * the literally-specified break needed a different vehicle, are recorded in the SUMMARY as a
 * deviation per criterion 2.
 * @remarks Row 5's own claim is corrected against the ACTUAL code, not the plan's paraphrase:
 * `FLIP_BACK_CLEARS_LAST_MARKER` (`column-transitions.ts:92`) deliberately EXCLUDES `needs_input`
 * (FLOW-05 — flipping out of `needs_input` stays byte-identical to before Phase 90, `lastMarker`
 * left UNTOUCHED), so this row asserts `lastMarker` STAYS SET after the flip-back — the true
 * invariant — rather than "clears" as the plan's own action text states. See the SUMMARY's
 * Deviations section.
 */
async function checkParityRows345(built) {
  const row3 = [];
  const row4 = [];
  const row5 = [];
  const only = built.sessionA;

  const garbageToken = randomBytes(32).toString("hex");
  const preStatus = await postHook(
    built,
    garbageToken,
    stopBodyWithReason("garbage-token-negative-case"),
  );
  const preWire = await fetchFixtureCard(built);
  console.log(
    `row 3 marker routing (negative case): POST Stop with a garbage, never-registered token -> ${preStatus} (expected 401); card.column after=${preWire?.column} (expected unchanged, "in_progress")`,
  );
  if (preStatus !== 401) {
    row3.push(
      `row 3 marker routing (negative case): garbage token POST returned ${preStatus}, expected 401`,
    );
  }
  if (preWire?.column !== "in_progress") {
    row3.push(
      `row 3 marker routing (negative case): card.column changed to "${preWire?.column}" after a garbage-token POST — a token that does not resolve must never be silently accepted`,
    );
  }

  const statusStop = await postHook(
    built,
    only.token,
    stopBodyWithReason("parity-lifecycle-reason"),
  );
  console.log(
    `row 3 marker routing (positive case): POST Stop via session 1's own token -> ${statusStop} (expected 204)`,
  );
  if (statusStop !== 204) {
    row3.push(
      `row 3 marker routing (positive case): POST Stop returned ${statusStop}, expected 204`,
    );
  }
  let wire = await fetchFixtureCard(built);
  console.log(
    `row 4 needs-input flip: wire card.column = ${wire?.column} (expected "needs_input")`,
  );
  if (wire?.column !== "needs_input") {
    row4.push(
      `row 4 needs-input flip: card.column expected "needs_input", actual "${wire?.column}"`,
    );
  }
  if (wire?.sessionCount !== undefined) {
    row4.push(
      `row 4 needs-input flip: wire card.sessionCount expected absent at N=1, actual ${wire?.sessionCount}`,
    );
  }
  const markerAfterStop = wire?.lastMarker;

  const statusPrompt = await postPromptSubmit(built, only.token);
  console.log(
    `row 5 flip-back: POST UserPromptSubmit -> ${statusPrompt} (expected 204)`,
  );
  if (statusPrompt !== 204) {
    row5.push(
      `row 5 flip-back: POST UserPromptSubmit returned ${statusPrompt}, expected 204`,
    );
  }
  wire = await fetchFixtureCard(built);
  console.log(
    `row 5 flip-back: wire card.column = ${wire?.column} (expected "in_progress"); lastMarker before=${JSON.stringify(markerAfterStop)} after=${JSON.stringify(wire?.lastMarker)} (expected STAYS SET — FLOW-05 excludes needs_input from FLIP_BACK_CLEARS_LAST_MARKER)`,
  );
  if (wire?.column !== "in_progress") {
    row5.push(
      `row 5 flip-back: card.column expected "in_progress" after flip-back, actual "${wire?.column}"`,
    );
  }
  if (wire?.lastMarker !== markerAfterStop) {
    row5.push(
      `row 5 flip-back: lastMarker expected to STAY SET at "${markerAfterStop}" (FLOW-05 — needs_input is excluded from FLIP_BACK_CLEARS_LAST_MARKER), actual ${JSON.stringify(wire?.lastMarker)}`,
    );
  }
  if (markerAfterStop == null) {
    row5.push(
      "row 5 flip-back: precondition failed — row 4's own Stop POST left lastMarker unset, so this row's \"stays set\" claim is unproven",
    );
  }

  const verdict3 =
    row3.length === 0 ? "PASS" : `FAIL (${row3.length} violation(s))`;
  const verdict4 =
    row4.length === 0 ? "PASS" : `FAIL (${row4.length} violation(s))`;
  const verdict5 =
    row5.length === 0 ? "PASS" : `FAIL (${row5.length} violation(s))`;
  console.log(`ROW 3 marker routing: ${verdict3}`);
  console.log(`ROW 4 needs-input flip: ${verdict4}`);
  console.log(`ROW 5 flip-back: ${verdict5}`);
  return [...row3, ...row4, ...row5];
}

/**
 * `KEEP-02` row 6 (terminal open). Open session 1's real terminal through the real proxy and
 * assert real, PER-RUN-UNIQUE bytes come back — never a successful WS upgrade alone, the exact
 * "reads connection success instead of content" dead-instrument shape `92-RESEARCH.md`'s own named
 * trap describes for a bare GET (which serves dispatch's own static bundle and never touches ttyd
 * — {@link readPaneThroughProxy}'s own WS-protocol read already avoids that trap by construction,
 * never issuing a GET). Also asserts the resolution needed nothing beyond the session's own id: the
 * wire card's `activeSession.id` IS `built.sessionA.id` directly, with no `sessionSummaries` list a
 * switcher could have consulted (already proven absent by row 1's own wire-shape assertion,
 * restated here as row 6's own precondition for its own resolution path).
 */
async function checkParityRow6TerminalOpen(built) {
  const violations = [];
  if (built.sessionA?.id == null) {
    violations.push(
      "row 6 terminal open: no session 1 id resolved — cannot open its terminal",
    );
    console.log(
      `ROW 6 terminal open: FAIL (${violations.length} violation(s))`,
    );
    return violations;
  }

  const wireCard = await fetchFixtureCard(built);
  console.log(
    `row 6 terminal open: wire card.activeSession.id=${JSON.stringify(wireCard?.activeSession?.id)} (expected "${built.sessionA.id}", the sole session — no switcher selection); hasOwn(sessionSummaries)=${Object.hasOwn(wireCard ?? {}, "sessionSummaries")} (expected false)`,
  );
  if (wireCard?.activeSession?.id !== built.sessionA.id) {
    violations.push(
      `row 6 terminal open: wire card.activeSession.id expected "${built.sessionA.id}" (the sole session, no switcher selection), actual ${JSON.stringify(wireCard?.activeSession?.id)}`,
    );
  }
  if (Object.hasOwn(wireCard ?? {}, "sessionSummaries")) {
    violations.push(
      `row 6 terminal open: wire card carries "sessionSummaries" at N=1 — a real switcher list existing would mean this row's "no switcher state consulted" claim is unproven`,
    );
  }

  const readyResult = await ensureSessionTerminalReady(
    built,
    built.sessionA.id,
  );
  if (!readyResult.ok) {
    violations.push(
      `row 6 terminal open: could not bring session 1's terminal up through the real proxy — ${readyResult.reason}`,
    );
    console.log(
      `ROW 6 terminal open: FAIL (${violations.length} violation(s))`,
    );
    return violations;
  }
  const token = `row6-${randomBytes(8).toString("hex")}`;
  await writePaneMarker(built.tmux.a, built.home, token);
  const read = await readPaneThroughProxy({
    port: built.port,
    idSegment: built.sessionA.id,
    expect: token,
    timeoutMs: PROXY_READ_TIMEOUT_MS,
  });
  console.log(
    `row 6 terminal open: real ttyd answered through the proxy with a per-run unique token — opened=${read.opened}, found=${read.text.includes(token)}`,
  );
  if (!read.opened) {
    violations.push(
      "row 6 terminal open: the WS upgrade never opened — never connected",
    );
  } else if (!read.text.includes(token)) {
    violations.push(
      `row 6 terminal open: real ttyd bytes did not include the per-run unique token "${token}" — connected but read the WRONG content`,
    );
  }

  const verdict =
    violations.length === 0
      ? "PASS"
      : `FAIL (${violations.length} violation(s))`;
  console.log(`ROW 6 terminal open: ${verdict}`);
  return violations;
}

/**
 * `--check parity-lifecycle` (Plan 96-04, Phase 96 Wave 3): the first six rows of the `KEEP-02`
 * single-session parity checklist — start, kickoff, marker routing, needs-input flip, flip-back,
 * terminal open — all against {@link PARITY_FIXTURE}'s ONE card, each reported as its own named
 * verdict. Rows 3/4/5 are {@link checkSingleSession}'s (Phase 91.1) own assertion shapes
 * re-asserted against this merged subject, cited as pre-existing coverage, never re-presented as
 * new. The accepted N=1 detail-panel deviation (Phase 94's UI-SPEC, the session region's corrected
 * 49px/45px row) is recorded in `96-04-SUMMARY.md`'s own preamble, not measured here and not
 * counted among the six rows this mode covers.
 */
async function checkParityLifecycle(built) {
  return [
    ...(await checkParityRow1Start(built)),
    ...(await checkParityRow2Kickoff(built)),
    ...(await checkParityRows345(built)),
    ...(await checkParityRow6TerminalOpen(built)),
  ];
}

/** POST the real `/api/cards/:id/resume` route against an ARBITRARY card id. */
async function postResumeForCard(built, cardId) {
  const res = await fetch(
    `http://127.0.0.1:${built.port}/api/cards/${cardId}/resume`,
    { method: "POST", headers: { "content-type": "application/json" } },
  );
  const body = await res.json().catch(() => undefined);
  return { status: res.status, body };
}

/**
 * Poll {@link fetchFixtureCard} until a resume attempt has settled on SUCCESS:
 * `sessionLost !== true` AND `tmuxSession` is live again. Never ambiguous with the pre-resume
 * state it is called from — every caller starts from `sessionLost === true, tmuxSession == null`,
 * a shape a successful resume can never merely resemble by accident, so (unlike
 * {@link waitForCardFirstStartSettled}'s own retry hazard) no "observed a tick first" gate is
 * needed here.
 */
async function waitForResumeSettled(built, { timeoutMs }) {
  const deadline = Date.now() + timeoutMs;
  let card;
  while (Date.now() < deadline) {
    card = await fetchFixtureCard(built);
    if (card != null && card.sessionLost !== true && card.tmuxSession != null) {
      return { card, timedOut: false };
    }
    await sleep(POLL_INTERVAL_MS);
  }
  return { card, timedOut: true };
}

/**
 * Poll {@link fetchFixtureCard} until a resume attempt has settled on FAILURE:
 * `resumeError != null` — {@link BoardStore.recordResumeFailure}'s own sentinel, populated in the
 * SAME atomic mutation as `sessionLost = true` and the session-field clear, so observing it is
 * sufficient to know the whole compensating write already landed.
 */
async function waitForResumeFailureSettled(built, { timeoutMs }) {
  const deadline = Date.now() + timeoutMs;
  let card;
  while (Date.now() < deadline) {
    card = await fetchFixtureCard(built);
    if (card != null && card.resumeError != null) {
      return { card, timedOut: false };
    }
    await sleep(POLL_INTERVAL_MS);
  }
  return { card, timedOut: true };
}

/**
 * Kill the real 3-strike detector's target and wait for the wire to derive `sessionLost === true`
 * — {@link checkSingleSession}'s own step-3 shape ({@link checkSingleSession}, Phase 91.1),
 * factored out here because rows 7, 8 and 12 all need it and each must reach it through the SAME
 * real detector, never a synthetic flag flip.
 */
async function driveToSessionLost(built) {
  const columnBeforeLoss = (await fetchFixtureCard(built))?.column;
  await tmuxKillSession(built.tmux.a);
  let sawLost = false;
  const deadline = Date.now() + LIVENESS_POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const wire = await fetchFixtureCard(built);
    if (wire?.sessionLost === true) {
      sawLost = true;
      break;
    }
    await sleep(LIVENESS_POLL_INTERVAL_MS);
  }
  return { sawLost, columnBeforeLoss };
}

/**
 * `KEEP-02` row 7 (resume, BOTH outcomes) against {@link PARITY_FIXTURE}'s own session, driven to
 * `sessionLost` the REAL way ({@link driveToSessionLost}, {@link checkSingleSession}'s own step-3
 * shape — a real tmux kill plus the real 3-strike watcher, never a synthetic flag flip). No
 * existing `--check` mode has ever called `POST /cards/:id/resume` — {@link checkSingleSession}
 * gets the card TO `sessionLost` and stops there — so both legs of this row are net-new coverage,
 * and `recordResumeFailure` specifically has never been exercised by any `--check` mode before
 * this one.
 * @remarks Order, and why: happy path first (the working hooks-capable stub is already live from
 * stand-up), THEN a SECOND real tmux kill drives the card back to `sessionLost` for the failure
 * leg (a forced `awaitReplReady` timeout via {@link writeExitingStubClaudeBinary},
 * {@link checkSecondStartRollbackDirection2}'s own forced-failure vehicle, applied here to resume
 * instead of start), THEN the working stub is restored and resume is driven ONE MORE time to
 * recover a live session — rows 8 and 12 both need one, and this third call is recovery, not a
 * new assertion leg, logged as such rather than silently folded into the failure leg's own claim.
 * @remarks Column-preserving on BOTH legs (`column-transitions.ts` item 11: "Resume /
 * resume-failed — column-PRESERVING — owner board.store.ts#resumeSession /
 * #recordResumeFailure"): every assertion below compares the column AFTER each leg against the
 * column this row itself recorded BEFORE that leg's own tmux kill, never against a hardcoded
 * literal, so the row is correct regardless of which column the fixture happens to be in.
 */
async function checkParityRow7Resume(built) {
  const violations = [];

  const { sawLost: sawLostHappy, columnBeforeLoss: columnBeforeHappy } =
    await driveToSessionLost(built);
  console.log(
    `row 7 resume (happy path): killed tmux ${built.tmux.a}, real 3-strike sessionLost observed=${sawLostHappy}, column before loss=${columnBeforeHappy}`,
  );
  if (!sawLostHappy) {
    violations.push(
      `row 7 resume (happy path): the real 3-strike detector did not derive sessionLost=true within ${LIVENESS_POLL_TIMEOUT_MS}ms — resume cannot be exercised without it`,
    );
    console.log(`ROW 7 resume: FAIL (${violations.length} violation(s))`);
    return violations;
  }

  const { status: happyStatus } = await postResumeForCard(built, built.cardId);
  console.log(
    `row 7 resume (happy path): POST /resume -> ${happyStatus} (expected 202)`,
  );
  if (happyStatus !== 202) {
    violations.push(
      `row 7 resume (happy path): POST /resume returned ${happyStatus}, expected 202`,
    );
  } else {
    const { card: resumed, timedOut } = await waitForResumeSettled(built, {
      timeoutMs: RESTART_REPL_TIMEOUT_SETTLE_MS,
    });
    console.log(
      `row 7 resume (happy path): settled — sessionLost=${resumed?.sessionLost} (expected not true), column=${resumed?.column} (expected preserved "${columnBeforeHappy}"), tmuxSession=${resumed?.tmuxSession} (expected live), timedOut=${timedOut}`,
    );
    if (timedOut) {
      violations.push(
        `row 7 resume (happy path): resume did not settle within ${RESTART_REPL_TIMEOUT_SETTLE_MS}ms`,
      );
    } else {
      if (resumed?.sessionLost === true) {
        violations.push(
          "row 7 resume (happy path): sessionLost still true after a successful resume",
        );
      }
      if (resumed?.column !== columnBeforeHappy) {
        violations.push(
          `row 7 resume (happy path): column changed from "${columnBeforeHappy}" to "${resumed?.column}" — resume is column-preserving per column-transitions.ts item 11`,
        );
      }
      if (resumed?.tmuxSession == null) {
        violations.push(
          `row 7 resume (happy path): card.tmuxSession expected live after resume, got ${resumed?.tmuxSession}`,
        );
      }
      const persisted = readCard(built.dbPath, built.cardId);
      const sessionCount = persisted?.sessions?.length ?? 0;
      console.log(
        `row 7 resume (happy path): persisted sessionCount=${sessionCount} (expected exactly 1)`,
      );
      if (sessionCount !== 1) {
        violations.push(
          `row 7 resume (happy path): persisted card owns ${sessionCount} session(s) after resume, expected exactly 1 (sessions=${JSON.stringify(persisted?.sessions)})`,
        );
      }
      const liveNames = await tmuxListSessionNames();
      if (!liveNames.includes(built.tmux.a)) {
        violations.push(
          `row 7 resume (happy path): real tmux session ${built.tmux.a} not found live after resume (live=${JSON.stringify(liveNames)})`,
        );
      }
      if (built.sessionA?.id != null) {
        const readyResult = await ensureSessionTerminalReady(
          built,
          built.sessionA.id,
        );
        if (!readyResult.ok) {
          violations.push(
            `row 7 resume (happy path): could not bring the resumed terminal up through the real proxy — ${readyResult.reason}`,
          );
        } else {
          const marker = `row7-${randomBytes(4).toString("hex")}`;
          await writePaneMarker(built.tmux.a, built.home, marker);
          const read = await readPaneThroughProxy({
            port: built.port,
            idSegment: built.sessionA.id,
            expect: marker,
            timeoutMs: PROXY_READ_TIMEOUT_MS,
          });
          console.log(
            `row 7 resume (happy path): real ttyd answered through the proxy — found marker=${read.text.includes(marker)}`,
          );
          if (!read.text.includes(marker)) {
            violations.push(
              `row 7 resume (happy path): real ttyd did not echo marker "${marker}" through the proxy after resume`,
            );
          }
        }
      }
      const wireCard = await fetchFixtureCard(built);
      console.log(
        `row 7 resume (happy path): wire card hasOwn(sessionCount)=${Object.hasOwn(wireCard ?? {}, "sessionCount")} hasOwn(sessionSummaries)=${Object.hasOwn(wireCard ?? {}, "sessionSummaries")} (both expected false at N=1)`,
      );
      if (Object.hasOwn(wireCard ?? {}, "sessionCount")) {
        violations.push(
          `row 7 resume (happy path): wire card carries "sessionCount" (${JSON.stringify(wireCard.sessionCount)}) at N=1 after resume — must be ABSENT`,
        );
      }
      if (Object.hasOwn(wireCard ?? {}, "sessionSummaries")) {
        violations.push(
          `row 7 resume (happy path): wire card carries "sessionSummaries" at N=1 after resume — must be ABSENT`,
        );
      }
    }
  }

  const { sawLost: sawLostFail, columnBeforeLoss: columnBeforeFail } =
    await driveToSessionLost(built);
  console.log(
    `row 7 resume (failure leg): killed tmux ${built.tmux.a} a second time, real 3-strike sessionLost observed=${sawLostFail}, column before loss=${columnBeforeFail}`,
  );
  if (!sawLostFail) {
    violations.push(
      `row 7 resume (failure leg): the real 3-strike detector did not re-derive sessionLost=true after the second kill`,
    );
    console.log(`ROW 7 resume: FAIL (${violations.length} violation(s))`);
    return violations;
  }

  writeExitingStubClaudeBinary(built.home);
  console.log(
    "row 7 resume (failure leg): swapped the stub claude for an exit-immediately variant — forcing resume's own awaitReplReady to time out, the same forced-failure vehicle checkSecondStartRollbackDirection2 uses for start",
  );
  const { status: failStatus } = await postResumeForCard(built, built.cardId);
  console.log(
    `row 7 resume (failure leg): POST /resume -> ${failStatus} (expected 202 — the failure surfaces async via SSE, the route's own response never reflects it)`,
  );
  if (failStatus !== 202) {
    violations.push(
      `row 7 resume (failure leg): POST /resume returned ${failStatus}, expected 202`,
    );
  } else {
    const { card: failed, timedOut: failTimedOut } =
      await waitForResumeFailureSettled(built, {
        timeoutMs: RESTART_REPL_TIMEOUT_SETTLE_MS,
      });
    console.log(
      `row 7 resume (failure leg): settled — resumeError=${JSON.stringify(failed?.resumeError)} (expected populated — recordResumeFailure fired), sessionLost=${failed?.sessionLost} (expected true), column=${failed?.column} (expected preserved "${columnBeforeFail}"), tmuxSession=${failed?.tmuxSession} (expected absent), timedOut=${failTimedOut}`,
    );
    if (failTimedOut) {
      violations.push(
        `row 7 resume (failure leg): forced resume failure did not settle within ${RESTART_REPL_TIMEOUT_SETTLE_MS}ms`,
      );
    } else {
      if (failed?.resumeError == null) {
        violations.push(
          "row 7 resume (failure leg): expected resumeError populated after a forced resume failure, got none — recordResumeFailure must have fired",
        );
      }
      if (failed?.sessionLost !== true) {
        violations.push(
          `row 7 resume (failure leg): sessionLost expected true after a failed resume, actual ${failed?.sessionLost}`,
        );
      }
      if (failed?.column !== columnBeforeFail) {
        violations.push(
          `row 7 resume (failure leg): column changed from "${columnBeforeFail}" to "${failed?.column}" — resume failure is column-preserving per column-transitions.ts item 11 (never asserted as a column CHANGE)`,
        );
      }
      if (failed?.tmuxSession != null) {
        violations.push(
          `row 7 resume (failure leg): card.tmuxSession expected absent after a failed resume, got "${failed?.tmuxSession}"`,
        );
      }
    }
  }

  writeHooksCapableStubClaudeBinary(built.home);
  console.log(
    "row 7 resume (recovery, not a new assertion leg): restored the hooks-capable stub claude and resuming once more so rows 8 and 12 have a live session to restart",
  );
  const { status: recoverStatus } = await postResumeForCard(
    built,
    built.cardId,
  );
  if (recoverStatus !== 202) {
    violations.push(
      `row 7 resume (recovery): POST /resume returned ${recoverStatus}, expected 202 — rows 8/12 require a live session to proceed`,
    );
  } else {
    const { card: recovered, timedOut: recoverTimedOut } =
      await waitForResumeSettled(built, {
        timeoutMs: RESTART_REPL_TIMEOUT_SETTLE_MS,
      });
    console.log(
      `row 7 resume (recovery): settled — sessionLost=${recovered?.sessionLost} (expected not true), tmuxSession=${recovered?.tmuxSession} (expected live), timedOut=${recoverTimedOut}`,
    );
    if (
      recoverTimedOut ||
      recovered?.sessionLost === true ||
      recovered?.tmuxSession == null
    ) {
      violations.push(
        "row 7 resume (recovery): could not recover a live session after the forced failure — rows 8 and 12 cannot proceed without one",
      );
    } else if (built.sessionA?.id != null) {
      // recordResumeFailure cleared the prior hookToken; the recovery resume minted a fresh one —
      // refresh the in-memory reference so any later row's hook POST uses the CURRENT token, not
      // the stand-up-time one this fixture originally captured.
      const persisted = readCard(built.dbPath, built.cardId);
      const record = persisted?.sessions?.find(
        (s) => s.id === built.sessionA.id,
      );
      if (record?.hookToken) built.sessionA.token = record.hookToken;
    }
  }

  const verdict =
    violations.length === 0
      ? "PASS"
      : `FAIL (${violations.length} violation(s))`;
  console.log(`ROW 7 resume: ${verdict}`);
  return violations;
}

/**
 * Kill the card's own bare-named tmux session then POST `/cards/:id/start` with NO `newSession`
 * flag — the exact request {@link SessionLostSection}'s "Restart" button sends
 * (`startCard(card.id, card.extraDirection ?? "")`,
 * `src/web/features/detail/SessionLostSection.tsx`). With `reserved` staying `null`
 * (`start-session.ts`'s own `if (wantsNewSession)` guard), the saga re-runs against the card's
 * EXISTING session id rather than minting a sibling — the property rows 8 and 12 both measure,
 * each from state it captures ITSELF via its own call to this function. Pre-killing tmux (rather
 * than calling restart against a still-live session) forces the FULL saga path rather than the
 * cheaper reattach branch, so {@link waitForCardFirstStartSettled}'s `sawProvisioning` gate
 * genuinely observes a tick from THIS call, not a stale one.
 */
async function driveRestart(
  built,
  { timeoutMs = RESTART_REPL_TIMEOUT_SETTLE_MS } = {},
) {
  await tmuxKillSessionExact(built.tmux.a);
  const { status, body } = await postStartForCard(built, built.cardId, {
    extraDirection: "",
  });
  if (status !== 202) {
    return {
      postFailed: true,
      startStatus: status,
      startBody: body,
      card: undefined,
      timedOut: false,
    };
  }
  const { card, timedOut } = await waitForCardFirstStartSettled(
    built,
    built.cardId,
    { timeoutMs },
  );
  return {
    postFailed: false,
    startStatus: status,
    startBody: body,
    card,
    timedOut,
  };
}

/**
 * `KEEP-02` row 8 (restart at TRUE N=1) — the decision `96-05-PLAN.md` makes explicit: assert at
 * genuine N=1, manufacture no sibling, and cite rather than re-execute the historical break.
 * @remarks The historical tmux prefix-kill regression (94-02's fix, 94-07 Direction 2's live
 * reproduction) required a LIVE SIBLING for a broken prefix-match to wrongly kill — structurally
 * UNREACHABLE at genuine N=1, where there is nothing else for a prefix match to land on. This row
 * therefore CITES `94-VERDICT.md`'s own verbatim break-and-revert evidence for that regression
 * (logged below, labelled explicitly as a citation) rather than re-executing it, and manufactures
 * NO sibling to do so — doing so inside a "single-session parity" row would disguise a two-session
 * check as a one-session one and re-prove a defect 94-07 already closed with better evidence.
 * @remarks This row's OWN executed break (Task 2) is the regression THIS milestone could actually
 * have introduced: Phase 94 added `reserveNewSession` and gated it behind `start-session.ts`'s own
 * `if (wantsNewSession)` branch — forcing a bare restart (no `newSession` flag) down that branch
 * would silently turn "restart" into "start another session", leaving the card owning TWO sessions
 * where it must own one. That is what this row's assertions below are built to catch.
 */
async function checkParityRow8Restart(built) {
  const violations = [];

  const beforePersisted = readCard(built.dbPath, built.cardId);
  const beforeSessionId = beforePersisted?.activeSessionId;
  const beforeSessionCount = beforePersisted?.sessions?.length ?? 0;
  console.log(
    `row 8 restart: before — session id=${beforeSessionId}, sessionCount=${beforeSessionCount}, tmux=${built.tmux.a}`,
  );
  if (beforeSessionCount !== 1) {
    violations.push(
      `row 8 restart: precondition failed — card owns ${beforeSessionCount} session(s) before restart, expected exactly 1 (row 7's own recovery leg must leave a genuinely live single session)`,
    );
    console.log(`ROW 8 restart: FAIL (${violations.length} violation(s))`);
    return violations;
  }

  const { postFailed, startStatus, card, timedOut } = await driveRestart(built);
  if (postFailed) {
    violations.push(
      `row 8 restart: POST /start returned ${startStatus}, expected 202`,
    );
    console.log(`ROW 8 restart: FAIL (${violations.length} violation(s))`);
    return violations;
  }
  console.log(
    `row 8 restart: settled — column=${card?.column}, startError=${JSON.stringify(card?.startError)} (expected none), tmuxSession=${card?.tmuxSession}, timedOut=${timedOut}`,
  );
  if (timedOut) {
    violations.push(
      `row 8 restart: restart saga did not settle within ${RESTART_REPL_TIMEOUT_SETTLE_MS}ms`,
    );
    console.log(`ROW 8 restart: FAIL (${violations.length} violation(s))`);
    return violations;
  }
  if (card?.startError != null) {
    violations.push(
      `row 8 restart: restart saga recorded a startError, expected a clean restart: ${JSON.stringify(card.startError)}`,
    );
  }

  const afterPersisted = readCard(built.dbPath, built.cardId);
  const afterSessionCount = afterPersisted?.sessions?.length ?? 0;
  const afterSessionId = afterPersisted?.activeSessionId;
  console.log(
    `row 8 restart: after — session id=${afterSessionId} (expected the SAME id as before, "${beforeSessionId}"), sessionCount=${afterSessionCount} (expected exactly 1)`,
  );
  if (afterSessionId !== beforeSessionId) {
    violations.push(
      `row 8 restart: session id changed across restart — before="${beforeSessionId}" after="${afterSessionId}", expected the SAME session id reused, never a freshly minted one`,
    );
  }
  if (afterSessionCount !== 1) {
    violations.push(
      `row 8 restart: persisted card owns ${afterSessionCount} session(s) after restart, expected exactly 1 (sessions=${JSON.stringify(afterPersisted?.sessions)})`,
    );
  }

  const liveNames = await tmuxListSessionNames();
  const expectedBare = built.tmux.a;
  const suffixPattern = new RegExp(
    `^${expectedBare.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-\\d+$`,
  );
  const suffixedSiblings = liveNames.filter((n) => suffixPattern.test(n));
  console.log(
    `row 8 restart: live tmux=${JSON.stringify(liveNames)}; bare "${expectedBare}" present=${liveNames.includes(expectedBare)}; suffixed siblings matching ${suffixPattern}=${JSON.stringify(suffixedSiblings)} (expected NONE)`,
  );
  if (!liveNames.includes(expectedBare)) {
    violations.push(
      `row 8 restart: expected the bare tmux session "${expectedBare}" live after restart, not found in ${JSON.stringify(liveNames)}`,
    );
  }
  if (suffixedSiblings.length > 0) {
    violations.push(
      `row 8 restart: a suffixed sibling tmux session exists after restart at true N=1 — ${JSON.stringify(suffixedSiblings)} — restart must reuse the same session, never mint another`,
    );
  }

  const wireCard = await fetchFixtureCard(built);
  console.log(
    `row 8 restart: wire card hasOwn(sessionCount)=${Object.hasOwn(wireCard ?? {}, "sessionCount")} hasOwn(sessionSummaries)=${Object.hasOwn(wireCard ?? {}, "sessionSummaries")} (both expected false at N=1)`,
  );
  if (Object.hasOwn(wireCard ?? {}, "sessionCount")) {
    violations.push(
      `row 8 restart: wire card carries "sessionCount" (${JSON.stringify(wireCard.sessionCount)}) after restart at N=1 — must be ABSENT, not merely falsy`,
    );
  }
  if (Object.hasOwn(wireCard ?? {}, "sessionSummaries")) {
    violations.push(
      `row 8 restart: wire card carries "sessionSummaries" after restart at N=1 — must be ABSENT, not merely falsy`,
    );
  }

  console.log(
    "row 8 restart (CITATION, not executed by this row): the historical tmux prefix-kill regression is structurally unreachable at genuine N=1 — it requires a live sibling for a broken prefix-match to wrongly kill. 94-VERDICT.md, verbatim: \"stripping the `=` exact-match prefix from steps.ts's rollback killSession reproduced the PHASE'S HEADLINE DEFECT: the unprefixed kill prefix-matched onto the live suffixed sibling and killed it, taking down the entire tmux server since it was the last session — Direction 2 failed naming the missing exact tmux name\" (94-02's fix, 94-07 Direction 2's live reproduction). This row CITES that evidence and does NOT re-execute it, and manufactures NO sibling to do so.",
  );

  const verdict =
    violations.length === 0
      ? "PASS"
      : `FAIL (${violations.length} violation(s))`;
  console.log(`ROW 8 restart: ${verdict}`);
  return violations;
}

/**
 * `KEEP-02` row 12 (restart durability) — a GENUINELY NEW check, not a restatement of
 * {@link checkSingleSession}'s own steps 4-5.
 *
 * **DISCLAIMER, load-bearing, also printed at runtime below:** `--check single-session`'s steps
 * 4-5 (`checkSingleSession`, Phase 91.1) kill the SERVER after a session was already KILLED and
 * marked lost by the real 3-strike detector — they prove a session that DIED stays correctly dead
 * across a backend reboot (its cleared `tmuxSession` and its stamped `outputChangedAt` survive).
 * That is a different claim from this row's: a session that was ACTUALLY RESTARTED survives a
 * LATER backend reboot with its LIVE fields intact. `checkSingleSession` never once calls the
 * restart route, so it cannot be evidence for this row's claim — the two share vocabulary
 * ("survives a restart") but are different code paths, exactly the adjacent-sounding-claim shape
 * `.planning/milestones/v2.9-ROADMAP.md`'s nine dead instruments were caught by
 * (`96-RESEARCH.md` Pitfall 1).
 * @remarks Sequence, strictly, and verifiable by reading this function alone: (1) restart the
 * session via {@link driveRestart} — row 8's own route, called again here so this row's own call
 * order proves the restart happened BEFORE the backend is ever killed; (2) ensure a genuinely live
 * terminal for the restarted session ({@link ensureSessionTerminalReady} — a restart's own
 * `completeStart` call explicitly clears `ttydPort`, so a fresh ttyd must be brought up before
 * there is anything for adoption to adopt); (3) capture the restarted session's identity via a
 * FRESH `readOnly: true` sqlite read; (4) kill the sandbox server and verify the port is free
 * before rebooting; (5) reboot on the SAME home/port and let `reconcileSessions` complete before
 * asserting (`bootstrap/index.ts` awaits it before `listen()`, so a post-`waitForReady` read is
 * already post-reconcile); (6) assert the RESTARTED session survived: same id, same bare tmux name
 * still live, its ttyd ADOPTED (not swept — LISTENING on the SAME port, never a respawned one),
 * its hook token re-registered and ROUTABLE (a real hook POST, not merely a persisted string
 * comparison), `sessionLost` not set, exactly one session, and the wire still carrying neither
 * `sessionCount` nor `sessionSummaries`.
 */
async function checkParityRow12RestartDurability(built) {
  const violations = [];

  console.log(
    "row 12 restart durability: DISCLAIMER — --check single-session's own steps 4-5 (checkSingleSession, Phase 91.1) kill the SERVER after a session was already KILLED and marked lost; they prove a DEAD session's persisted fields survive a reboot, never that a RESTARTED session does. This row restarts the session FIRST (below), then kills the backend — the sequence that makes it a genuine restart-durability claim — and is NEW coverage, not a restatement of that one.",
  );

  const {
    postFailed,
    startStatus,
    card: restarted,
    timedOut: restartTimedOut,
  } = await driveRestart(built);
  if (postFailed || restartTimedOut || restarted?.startError != null) {
    violations.push(
      `row 12 restart durability: the precondition restart (row 8's own route) did not settle cleanly — postFailed=${postFailed} startStatus=${startStatus} timedOut=${restartTimedOut} startError=${JSON.stringify(restarted?.startError)} — cannot measure durability without a genuinely restarted session`,
    );
    console.log(
      `ROW 12 restart durability: FAIL (${violations.length} violation(s))`,
    );
    return violations;
  }
  console.log(
    `row 12 restart durability: precondition restart settled — tmuxSession=${restarted?.tmuxSession}`,
  );

  if (built.sessionA?.id != null) {
    const readyResult = await ensureSessionTerminalReady(
      built,
      built.sessionA.id,
    );
    console.log(
      `row 12 restart durability: ensured a live terminal for the restarted session — ok=${readyResult.ok}${readyResult.ok ? "" : ` (${readyResult.reason})`}`,
    );
    if (!readyResult.ok) {
      violations.push(
        `row 12 restart durability: could not bring the restarted session's own terminal up before reboot — ${readyResult.reason}`,
      );
      console.log(
        `ROW 12 restart durability: FAIL (${violations.length} violation(s))`,
      );
      return violations;
    }
  }

  const beforeReboot = readCard(built.dbPath, built.cardId);
  const beforeRecord = beforeReboot?.sessions?.find(
    (s) => s.id === beforeReboot?.activeSessionId,
  );
  if (!beforeRecord) {
    violations.push(
      "row 12 restart durability: could not resolve the restarted session's own persisted record before reboot",
    );
    console.log(
      `ROW 12 restart durability: FAIL (${violations.length} violation(s))`,
    );
    return violations;
  }
  const restartedSessionId = beforeRecord.id;
  const restartedTmuxSession = beforeRecord.tmuxSession;
  const restartedTtydPort = beforeRecord.ttydPort;
  console.log(
    `row 12 restart durability: captured the RESTARTED session's identity before reboot — id=${restartedSessionId} tmux=${restartedTmuxSession} ttydPort=${restartedTtydPort} workspacePath=${beforeRecord.workspacePath}`,
  );

  await killAndWait(built.server?.child);
  const stillListening = await isPortListening(built.port);
  console.log(
    `row 12 restart durability: sandbox server killed — port ${built.port} still listening=${stillListening} (expected false)`,
  );
  if (stillListening) {
    violations.push(
      `row 12 restart durability: sandbox server port ${built.port} still listening after kill — refusing to reboot onto a live orphan`,
    );
    console.log(
      `ROW 12 restart durability: FAIL (${violations.length} violation(s))`,
    );
    return violations;
  }

  built.server = bootServer(built.home, { pathPrefix: built.pathPrefix });
  await waitForReady(built.port);
  console.log(
    `row 12 restart durability: sandbox server rebooted on :${built.port} — waitForReady resolved, so reconcileSessions (awaited before listen()) has already completed`,
  );

  const afterReboot = readCard(built.dbPath, built.cardId);
  const afterRecord = afterReboot?.sessions?.find(
    (s) => s.id === restartedSessionId,
  );
  const sessionCountAfter = afterReboot?.sessions?.length ?? 0;
  console.log(
    `row 12 restart durability: after reboot — persisted sessionCount=${sessionCountAfter} (expected 1), record present=${!!afterRecord}, tmuxSession=${afterRecord?.tmuxSession} (expected "${restartedTmuxSession}"), sessionLost=${afterReboot?.sessionLost} (expected not true), activeSessionId=${afterReboot?.activeSessionId} (expected "${restartedSessionId}")`,
  );
  if (sessionCountAfter !== 1) {
    violations.push(
      `row 12 restart durability: persisted card owns ${sessionCountAfter} session(s) after reboot, expected exactly 1`,
    );
  }
  if (!afterRecord) {
    violations.push(
      `row 12 restart durability: the restarted session ${restartedSessionId} is missing from persisted sessions[] after reboot`,
    );
  } else if (afterRecord.tmuxSession !== restartedTmuxSession) {
    violations.push(
      `row 12 restart durability: the restarted session's tmuxSession changed across reboot — before="${restartedTmuxSession}" after="${afterRecord.tmuxSession}"`,
    );
  }
  if (afterReboot?.sessionLost === true) {
    violations.push(
      "row 12 restart durability: card.sessionLost is true after reboot — the RESTARTED session must survive, not be swept as dead",
    );
  }
  if (afterReboot?.activeSessionId !== restartedSessionId) {
    violations.push(
      `row 12 restart durability: activeSessionId after reboot expected the restarted session "${restartedSessionId}", actual "${afterReboot?.activeSessionId}"`,
    );
  }

  const liveNames = await tmuxListSessionNames();
  console.log(
    `row 12 restart durability: real tmux "${restartedTmuxSession}" live after reboot=${liveNames.includes(restartedTmuxSession)}`,
  );
  if (!liveNames.includes(restartedTmuxSession)) {
    violations.push(
      `row 12 restart durability: real tmux session "${restartedTmuxSession}" not found live after reboot — expected exact-match survival, not just a persisted record`,
    );
  }

  if (restartedTtydPort != null) {
    const ttydListening = await isPortListening(restartedTtydPort);
    console.log(
      `row 12 restart durability: restarted session's ttyd port ${restartedTtydPort} listening after reboot=${ttydListening} (expected true — ADOPTED, not swept)`,
    );
    if (!ttydListening) {
      violations.push(
        `row 12 restart durability: restarted session's ttyd port ${restartedTtydPort} not LISTENING after reboot — it must be ADOPTED, not swept`,
      );
    }
    if (afterRecord && afterRecord.ttydPort !== restartedTtydPort) {
      violations.push(
        `row 12 restart durability: persisted ttydPort changed across reboot — before=${restartedTtydPort} after=${afterRecord.ttydPort} — adoption must keep the SAME port, never respawn a new one`,
      );
    }
  } else {
    violations.push(
      "row 12 restart durability: the restarted session had no ttydPort before reboot — the terminal-ensure step above should have set one",
    );
  }

  const tokenAfter = afterRecord?.hookToken;
  console.log(
    `row 12 restart durability: hook token present after reboot=${tokenAfter != null} (expected truthy — re-registered by reconcileSessions's hookToken rebuild)`,
  );
  if (tokenAfter == null) {
    violations.push(
      "row 12 restart durability: persisted hookToken is absent after reboot — reconcileSessions's rebuild must re-register one for a still-live session",
    );
  } else {
    const hookStatus = await postHook(
      built,
      tokenAfter,
      stopBodyWithReason("row-12-restart-durability"),
    );
    console.log(
      `row 12 restart durability: POST a real hook with the post-reboot token -> ${hookStatus} (expected 204 — the token must be ROUTABLE, not merely a persisted string)`,
    );
    if (hookStatus !== 204) {
      violations.push(
        `row 12 restart durability: POST hook with the post-reboot token returned ${hookStatus}, expected 204 — the token must resolve through reconcileSessions's registerHookToken rebuild, not merely persist on disk`,
      );
    }
  }

  const wireCard = await fetchFixtureCard(built);
  console.log(
    `row 12 restart durability: wire card hasOwn(sessionCount)=${Object.hasOwn(wireCard ?? {}, "sessionCount")} hasOwn(sessionSummaries)=${Object.hasOwn(wireCard ?? {}, "sessionSummaries")} (both expected false at N=1)`,
  );
  if (Object.hasOwn(wireCard ?? {}, "sessionCount")) {
    violations.push(
      `row 12 restart durability: wire card carries "sessionCount" after reboot at N=1 — must be ABSENT, not merely falsy`,
    );
  }
  if (Object.hasOwn(wireCard ?? {}, "sessionSummaries")) {
    violations.push(
      `row 12 restart durability: wire card carries "sessionSummaries" after reboot at N=1 — must be ABSENT, not merely falsy`,
    );
  }

  const verdict =
    violations.length === 0
      ? "PASS"
      : `FAIL (${violations.length} violation(s))`;
  console.log(
    `ROW 12 restart durability: ${verdict} — DISCLAIMER: this is NEW coverage; --check single-session's steps 4-5 prove a killed-not-restarted session's persisted fields survive a reboot, a DIFFERENT claim than this row's`,
  );
  return violations;
}

/**
 * `--check parity-recovery` (Plan 96-05, Phase 96 Wave 4): the three `KEEP-02` rows with the LEAST
 * prior coverage — resume (row 7, both outcomes), restart at true N=1 (row 8), and restart
 * durability (row 12) — against {@link PARITY_FIXTURE}'s ONE card, each its own independently
 * named verdict. Row 7 ends by resuming the session (its own recovery leg, not a new claim), so
 * rows 8 and 12 both start from a genuinely live single session with no redundant stand-up. Row
 * 12 calls {@link driveRestart} a second time itself (row 8 already proved its own claim with its
 * own call) so its own "restart before kill" sequencing is provable by reading row 12's function
 * alone, never by borrowing row 8's.
 */
async function checkParityRecovery(built) {
  return [
    ...(await checkParityRow7Resume(built)),
    ...(await checkParityRow8Restart(built)),
    ...(await checkParityRow12RestartDurability(built)),
  ];
}

/**
 * `KEEP-02` row 9's own literal mirrors of `cards.route.ts`'s module-private refusal message text
 * (`manualMoveTransitionError` / `inboxTransitionError` are never exported — there is no function
 * to import for the message half). A future change to either message's TEXT fails this row's own
 * strict-equality assertion rather than drifting silently.
 */
const MSG_AGENT_DONE_BLOCKED =
  "Agent Done is set automatically by a real agent completion signal — it is never a manual move target";
const MSG_TODO_TO_IN_PROGRESS_BLOCKED =
  "starting a To Do card requires the start flow — drag it to In Progress (or use Start) rather than posting a bare move";
const MSG_INBOX_ONLY_PROMOTE = "inbox cards can only be promoted to To Do";
const MSG_INBOX_ONLY_FROM_TODO = "only To Do cards can be moved to Inbox";
const MSG_INBOX_SESSION_HISTORY =
  "cards with session history cannot be moved to Inbox";

/**
 * Row 9's own INDEPENDENT restatement of `column-transitions.ts`'s `blocksAgentDoneManualEntry` —
 * an "explicitly-stated table" (`96-06-PLAN.md`'s own sanctioned alternative to importing the live
 * predicate: "derived... from the predicates' own definitions OR from an explicitly-stated table
 * that a source change would invalidate"). Deliberately NOT a dynamic `import()` of the real
 * function: {@link checkParityRow9Moves} derives its own "expected" outcome from THIS restatement,
 * and `96-06-PLAN.md`'s own break table specifies inverting the REAL predicate
 * (`blocksTodoToInProgressManualMove` — see {@link isTodoToInProgressManualMoveBlocked}) as row
 * 9's proof-of-failure. If this row imported the SAME function the product enforces with to
 * compute its own expectation, that break would move "expected" and "actual" in lockstep — the
 * row would keep reporting PASS against its own now-also-broken expectation, exactly the
 * dead-instrument shape this milestone exists to catch. Confirmed by inspection to match
 * `column-transitions.ts`'s own `blocksAgentDoneManualEntry` at HEAD `8a92400` (BOARD-07: any
 * `X -> agent_done` is refused); re-confirm this restatement on any future read of that file.
 */
function isAgentDoneManualTargetBlocked(to) {
  return to === "agent_done";
}

/**
 * Row 9's own independent restatement of `column-transitions.ts`'s
 * `blocksTodoToInProgressManualMove` — same rationale and same non-import discipline as
 * {@link isAgentDoneManualTargetBlocked}'s own JSDoc. Confirmed by inspection to match the real
 * predicate at HEAD `8a92400` (`todo -> in_progress` is reserved for the start saga).
 */
function isTodoToInProgressManualMoveBlocked(from, to) {
  return from === "todo" && to === "in_progress";
}

/**
 * Row 9's own independent restatement of `demote-eligibility.ts`'s `isDemoteEligible` — same
 * non-import discipline as {@link isAgentDoneManualTargetBlocked}'s own JSDoc, so a future change
 * to any of the six real fields the live predicate inspects diverges from this row's own
 * expectation instead of moving with it. Confirmed by inspection to match the real predicate's own
 * six fields at HEAD `8a92400`.
 */
function isDemoteEligibleIndependent(card) {
  return (
    card?.branch == null &&
    card?.tmuxSession == null &&
    card?.claudeSessionId == null &&
    card?.workspacePath == null &&
    card?.provisioningStep == null &&
    card?.startError == null
  );
}

/**
 * Derive the EXPECTED outcome of a `(from, to)` manual move from row 9's own independent
 * restatements above (never the live, importable predicates — see
 * {@link isAgentDoneManualTargetBlocked}'s own JSDoc for why) plus `demoteEligible` (the caller's
 * own single {@link isDemoteEligibleIndependent} read). Mirrors `cards.route.ts`'s own branch
 * ORDER exactly (`inboxTransitionError` decides first, then `manualMoveTransitionError`), so a
 * future reordering of that precedence is also caught, not only a change to either predicate's own
 * boolean result. Returns `{ legal: true }` or `{ legal: false, message }`.
 */
function deriveExpectedMoveOutcome(from, to, demoteEligible) {
  if (from === "inbox") {
    if (to === "todo") return { legal: true };
    return { legal: false, message: MSG_INBOX_ONLY_PROMOTE };
  }
  if (to === "inbox") {
    if (from !== "todo")
      return { legal: false, message: MSG_INBOX_ONLY_FROM_TODO };
    if (!demoteEligible)
      return { legal: false, message: MSG_INBOX_SESSION_HISTORY };
    return { legal: true };
  }
  if (isAgentDoneManualTargetBlocked(to)) {
    return { legal: false, message: MSG_AGENT_DONE_BLOCKED };
  }
  if (isTodoToInProgressManualMoveBlocked(from, to)) {
    return { legal: false, message: MSG_TODO_TO_IN_PROGRESS_BLOCKED };
  }
  return { legal: true };
}

/**
 * Reset {@link PARITY_FIXTURE}'s own card to `target` using only REAL, legal affordances — never a
 * direct store/sqlite write — so every one of row 9's 36 driven pairs starts from a state the
 * product itself can actually reach. Two targets need a real detour:
 * - `agent_done`: a manual move can NEVER legally enter it (`blocksAgentDoneManualEntry`), so this
 *   bounces through `needs_input` (always a legal manual target) and then POSTs a real, uniquely
 *   worded `DONE` marker over the fixture's own hook token ({@link doneBodyWithSummary} —
 *   `applyMarker`, a DIFFERENT code path than `moveCardManual` that legally reaches `agent_done`).
 * - `in_progress` when the card is currently `todo`: `todo -> in_progress` is itself manual-move-
 *   blocked (`blocksTodoToInProgressManualMove`), so this bounces through `needs_input` first.
 * Every other target is one legal manual hop away from any state this card can be in.
 */
async function resetParityCardToColumn(built, target, tag, violations) {
  const before = await fetchFixtureCard(built);
  if (before?.column === target) return true;
  if (target === "agent_done") {
    if (before?.column !== "needs_input") {
      const bounce = await postMoveForCard(built, built.cardId, "needs_input");
      if (bounce.status !== 204) {
        violations.push(
          `row 9 reset (${tag}): bounce to needs_input before entering agent_done returned ${bounce.status}, expected 204 (body=${JSON.stringify(bounce.body)})`,
        );
        return false;
      }
    }
    const markerStatus = await postHook(
      built,
      built.sessionA.token,
      doneBodyWithSummary(
        `row9-reset-${tag}-${randomBytes(3).toString("hex")}`,
      ),
    );
    if (markerStatus !== 204) {
      violations.push(
        `row 9 reset (${tag}): DONE marker POST to enter agent_done returned ${markerStatus}, expected 204`,
      );
      return false;
    }
    const after = await fetchFixtureCard(built);
    if (after?.column !== "agent_done") {
      violations.push(
        `row 9 reset (${tag}): after a real DONE marker, card.column is "${after?.column}", expected "agent_done"`,
      );
      return false;
    }
    return true;
  }
  if (target === "in_progress" && before?.column === "todo") {
    const bounce = await postMoveForCard(built, built.cardId, "needs_input");
    if (bounce.status !== 204) {
      violations.push(
        `row 9 reset (${tag}): bounce to needs_input before todo -> in_progress returned ${bounce.status}, expected 204 (body=${JSON.stringify(bounce.body)})`,
      );
      return false;
    }
  }
  const move = await postMoveForCard(built, built.cardId, target);
  if (move.status !== 204) {
    violations.push(
      `row 9 reset (${tag}): moving to "${target}" returned ${move.status}, expected 204 (body=${JSON.stringify(move.body)})`,
    );
    return false;
  }
  return true;
}

/**
 * `KEEP-02` row 9 (a drag across every column edge). The PAIR SET is DERIVED from the product's
 * own source AT RUNTIME — never a hardcoded 42-literal table — via
 * `MOVABLE_COLUMNS = [...COLUMNS, "inbox"]` (the exact expression `cards.route.ts` itself uses,
 * `COLUMNS` loaded live from `dist/shared/types.js`). Each pair's EXPECTED outcome is derived from
 * {@link deriveExpectedMoveOutcome}'s own independent restatement of the two blocked shapes and
 * the inbox demote-eligibility gate — an "explicitly-stated table" (`96-06-PLAN.md`'s own
 * sanctioned alternative to importing the live predicate; see
 * {@link isAgentDoneManualTargetBlocked}'s own JSDoc for why THIS row specifically must not import
 * the same function the product enforces with). A future change to either predicate's BOOLEAN
 * shape diverges from this row's own restatement and correctly fails it; a future change to either
 * route's own refusal MESSAGE TEXT fails this row's strict-equality assertion instead.
 * @remarks {@link PARITY_FIXTURE}'s own card carries real session history for the WHOLE row (its
 * one live session is never killed here), so demote-eligibility is read ONCE, up front, via
 * {@link isDemoteEligibleIndependent}, and stays `false` for the entire row by construction — the
 * six fields it inspects (`branch`/`tmuxSession`/`claudeSessionId`/`workspacePath`/
 * `provisioningStep`/`startError`) are session-mirror fields a plain column move never touches.
 * @remarks The 6 `from === "inbox"` pairs cannot be driven against {@link PARITY_FIXTURE}'s own
 * card — a card carrying real session history can never legally ENTER `inbox` (demote-eligibility
 * permanently `false`), so there is no live state to reset it FROM. They are driven instead
 * against a SECOND, throwaway, genuinely demote-eligible sessionless card (reusing
 * {@link createRollbackStartCard}'s own real-`POST /cards` pattern), which also gives sub-part
 * (d)'s no-fan-out assertion a real second card whose own column this row watches stay untouched
 * by every move on {@link PARITY_FIXTURE}'s own card.
 * @remarks Sub-part (d) (the ordinary-card no-fan-out claim) is driven ONCE, via one representative
 * legal move, not re-checked on every one of the 42 pairs — `mirrorMemberColumn`'s own guard is a
 * single `if (!card.memberIds || card.memberIds.length === 0) return;` at the top of the function,
 * not a per-column special case, so one legal move already exercises the exact same early return
 * every other legal move in this row would. The positive counterpart (a legal move on a GROUP
 * PARENT mirroring atomically to its members) is plan 96-07's own `--check group-session-guard`
 * against `GROUP_SESSION_FIXTURE` — cited here, not duplicated.
 */
async function checkParityRow9Moves(built) {
  const violations = [];
  const { COLUMNS } = await loadTypes();
  const MOVABLE_COLUMNS = [...COLUMNS, "inbox"];
  const expectedPairCount =
    MOVABLE_COLUMNS.length * (MOVABLE_COLUMNS.length - 1);
  console.log(
    `row 9 moves: MOVABLE_COLUMNS=${JSON.stringify(MOVABLE_COLUMNS)} (${MOVABLE_COLUMNS.length} columns) — expecting ${expectedPairCount} ordered pairs, computed as length*(length-1)`,
  );

  const persisted = readCard(built.dbPath, built.cardId);
  const demoteEligible = persisted
    ? isDemoteEligibleIndependent(persisted)
    : false;
  console.log(
    `row 9 moves: PARITY_FIXTURE card isDemoteEligible=${demoteEligible} (expected false — the card carries real session history)`,
  );
  if (demoteEligible) {
    violations.push(
      "row 9 moves: PRECONDITION FAILED — PARITY_FIXTURE's own card reads isDemoteEligible=true; every to=inbox expectation below assumes false (session history present)",
    );
  }

  const throwaway = await createRollbackStartCard(built);
  console.log(
    `row 9 moves: throwaway inbox-eligible card created — id=${throwaway.cardId} identifier=${throwaway.identifier}`,
  );
  let throwawayColumn = "todo";

  let pairsDriven = 0;
  const NON_INBOX_SOURCES = MOVABLE_COLUMNS.filter((c) => c !== "inbox");

  const beforeFanout = await fetchFixtureCard(built);
  const fanoutTarget =
    beforeFanout?.column === "needs_input" ? "in_review" : "needs_input";
  const fanoutMove = await postMoveForCard(built, built.cardId, fanoutTarget);
  console.log(
    `row 9 moves (sub-part d, no-fan-out): PARITY_FIXTURE ${beforeFanout?.column} -> ${fanoutTarget} -> ${fanoutMove.status} (expected 204)`,
  );
  if (fanoutMove.status !== 204) {
    violations.push(
      `row 9 moves (sub-part d): representative legal move ${beforeFanout?.column} -> ${fanoutTarget} returned ${fanoutMove.status}, expected 204`,
    );
  }
  const afterFanoutWire = await fetchFixtureCard(built);
  const afterFanoutThrowaway = await fetchCardById(built, throwaway.cardId);
  console.log(
    `row 9 moves (sub-part d, no-fan-out): PARITY_FIXTURE.groupId=${JSON.stringify(afterFanoutWire?.groupId)} memberIds=${JSON.stringify(afterFanoutWire?.memberIds)} (both expected absent/empty — an ordinary card); throwaway card column after=${afterFanoutThrowaway.body?.card?.column} (expected unchanged "${throwawayColumn}")`,
  );
  if (afterFanoutWire?.groupId != null) {
    violations.push(
      `row 9 moves (sub-part d): PARITY_FIXTURE's own card carries a groupId (${afterFanoutWire.groupId}) — it must be an ordinary, ungrouped card for this row's no-fan-out claim to mean anything`,
    );
  }
  if (
    Array.isArray(afterFanoutWire?.memberIds) &&
    afterFanoutWire.memberIds.length > 0
  ) {
    violations.push(
      `row 9 moves (sub-part d): PARITY_FIXTURE's own card carries memberIds (${JSON.stringify(afterFanoutWire.memberIds)}) — mirrorMemberColumn would have a real fan-out target, which this row's claim requires to be absent`,
    );
  }
  if (afterFanoutThrowaway.body?.card?.column !== throwawayColumn) {
    violations.push(
      `row 9 moves (sub-part d): the ONLY other card in this fixture's board changed column ("${throwawayColumn}" -> "${afterFanoutThrowaway.body?.card?.column}") as a side effect of a legal move on the ordinary PARITY_FIXTURE card — mirrorMemberColumn must never fire for a non-group card (the positive group-mirroring counterpart is plan 96-07's own check, not duplicated here)`,
    );
  }

  for (const from of NON_INBOX_SOURCES) {
    for (const to of MOVABLE_COLUMNS) {
      if (to === from) continue;
      pairsDriven++;
      const tag = `${from}->${to}`;
      const resetOk = await resetParityCardToColumn(
        built,
        from,
        tag,
        violations,
      );
      if (!resetOk) continue;
      const expected = deriveExpectedMoveOutcome(from, to, demoteEligible);
      const { status, body } = await postMoveForCard(built, built.cardId, to);
      if (expected.legal) {
        if (status !== 204) {
          violations.push(
            `row 9 moves (${tag}): expected LEGAL (204), got ${status} (body=${JSON.stringify(body)})`,
          );
          continue;
        }
        const wire = await fetchFixtureCard(built);
        if (wire?.column !== to) {
          violations.push(
            `row 9 moves (${tag}): move returned 204 but wire card.column is "${wire?.column}", expected "${to}"`,
          );
        }
        const hasSessionCount = Object.hasOwn(wire ?? {}, "sessionCount");
        const hasSessionSummaries = Object.hasOwn(
          wire ?? {},
          "sessionSummaries",
        );
        if (hasSessionCount || hasSessionSummaries) {
          violations.push(
            `row 9 moves (${tag}): wire card carries hasOwn(sessionCount)=${hasSessionCount} hasOwn(sessionSummaries)=${hasSessionSummaries} after a legal move at N=1 — both must be ABSENT`,
          );
        }
      } else {
        if (status !== 409) {
          violations.push(
            `row 9 moves (${tag}): expected BLOCKED (409, "${expected.message}"), got ${status} (body=${JSON.stringify(body)})`,
          );
          continue;
        }
        if (body?.error !== expected.message) {
          violations.push(
            `row 9 moves (${tag}): 409 body.error="${body?.error}", expected exactly "${expected.message}"`,
          );
        }
        const wire = await fetchFixtureCard(built);
        if (wire?.column !== from) {
          violations.push(
            `row 9 moves (${tag}): a BLOCKED move changed card.column to "${wire?.column}", expected it to stay "${from}"`,
          );
        }
      }
    }
  }

  const enterInbox = await postMoveForCard(built, throwaway.cardId, "inbox");
  console.log(
    `row 9 moves (inbox family): throwaway card todo -> inbox -> ${enterInbox.status} (expected 204 — a genuinely demote-eligible card)`,
  );
  if (enterInbox.status !== 204) {
    violations.push(
      `row 9 moves (inbox family): the throwaway demote-eligible card could not enter inbox — POST /move returned ${enterInbox.status} (body=${JSON.stringify(enterInbox.body)}), expected 204; the 6 from="inbox" pairs cannot be driven without this precondition`,
    );
  } else {
    throwawayColumn = "inbox";
    const inboxTargets = MOVABLE_COLUMNS.filter(
      (c) => c !== "inbox" && c !== "todo",
    );
    for (const to of inboxTargets) {
      pairsDriven++;
      const tag = `inbox->${to}`;
      const { status, body } = await postMoveForCard(
        built,
        throwaway.cardId,
        to,
      );
      if (status !== 409) {
        violations.push(
          `row 9 moves (${tag}): expected BLOCKED (409, "${MSG_INBOX_ONLY_PROMOTE}"), got ${status} (body=${JSON.stringify(body)})`,
        );
        continue;
      }
      if (body?.error !== MSG_INBOX_ONLY_PROMOTE) {
        violations.push(
          `row 9 moves (${tag}): 409 body.error="${body?.error}", expected exactly "${MSG_INBOX_ONLY_PROMOTE}"`,
        );
      }
    }
    pairsDriven++;
    const promote = await postMoveForCard(built, throwaway.cardId, "todo");
    console.log(
      `row 9 moves (inbox->todo): throwaway card inbox -> todo -> ${promote.status} (expected 204 — the sole legal inbox transition)`,
    );
    if (promote.status !== 204) {
      violations.push(
        `row 9 moves (inbox->todo): expected LEGAL (204), got ${promote.status} (body=${JSON.stringify(promote.body)})`,
      );
    } else {
      throwawayColumn = "todo";
    }
  }

  console.log(
    `row 9 moves: pairs driven=${pairsDriven} (expected ${expectedPairCount})`,
  );
  if (pairsDriven !== expectedPairCount) {
    violations.push(
      `row 9 moves: drove ${pairsDriven} ordered pairs, expected exactly ${expectedPairCount} (MOVABLE_COLUMNS.length * (MOVABLE_COLUMNS.length - 1))`,
    );
  }

  console.log(
    `ROW 9 moves: ${violations.length === 0 ? "PASS" : `FAIL (${violations.length} violation(s))`}`,
  );
  return violations;
}

/**
 * `KEEP-02` row 10 (the Done schedule) against {@link PARITY_FIXTURE}'s own N=1 subject.
 * `checkCleanupScheduleRestart` (Phase 93) already proves this claim, but ONLY against
 * `WORKTREE_FIXTURE` — a genuinely TWO-session fixture (`sessionKeys: ["a", "b"]`, confirmed by
 * reading its own `"cleanup-schedule-restart"` `CHECKS` wiring) — so its own coverage is NOT cited
 * here (`96-06-PLAN.md`'s own branch: "if its subject is two-session, row 10 drives the Done
 * schedule against PARITY_FIXTURE here"). This row drives a genuine Done arrival on the real N=1
 * card through the real `/move` route, confirms `cleanupDueAt` is stamped on both the session and
 * the card-level mirror, then — because a real arrival's own `cleanupDelayMs` is DAYS in the
 * future, never observable within this row's own runtime — backdates that SAME real timestamp
 * directly on disk (the exact technique `checkCleanupScheduleRestartFalsifiability` already
 * established for `WORKTREE_FIXTURE`) before driving the SAME overridable scheduler tick 93-03
 * added (`DISPATCH_CLEANUP_TICK_MS`) and confirming the scheduled teardown actually fires for the
 * card's ONE session.
 * @remarks Bounces done -> todo -> done first: row 9 leaves the card sitting in `done` as a side
 * effect of covering a DIFFERENT claim (its own last-driven pair), and `moveCardManual`'s own
 * `from !== "done"` guard means a redundant done->done move would never mint a fresh schedule —
 * this row's own claim needs a GENUINE arrival, not row 9's leftover state.
 * @remarks LIVE-CAUGHT: the backdating reboot passes `{ pathPrefix: built.pathPrefix }` to
 * {@link bootServer} — a first attempt omitted it (mirroring `restartServer`'s own
 * pathPrefix-less reboot, which is safe for rows 8/12 because THEY never spawn a NEW `claude`
 * process after reboot, only re-adopt an already-live one) and left the rebooted process's `PATH`
 * without the fixture's own hooks-capable stub `claude`. Row 10 itself never spawns a session, so
 * this omission never fails row 10's own assertions — it only surfaces one row later, when row 11
 * drives a genuinely NEW `POST /start` against the SAME `built.server` this row rebooted, and that
 * start hangs (a real-world `claude` binary or none at all on `PATH`, not the stub). Fixed here so
 * every reboot after PARITY_FIXTURE's own real-saga stand-up preserves the stub consistently.
 */
async function checkParityRow10DoneSchedule(built) {
  const violations = [];
  console.log(
    'row 10 Done schedule: checkCleanupScheduleRestart (Phase 93) runs ONLY against WORKTREE_FIXTURE (sessionKeys: ["a","b"], a genuine two-session subject) — NOT N=1-shaped, so this row DRIVES the claim fresh against PARITY_FIXTURE\'s own N=1 card rather than citing that coverage.',
  );

  const outMove = await postMoveForCard(built, built.cardId, "todo");
  if (outMove.status !== 204) {
    violations.push(
      `row 10 Done schedule: precondition move to todo returned ${outMove.status}, expected 204 (body=${JSON.stringify(outMove.body)})`,
    );
    console.log(
      `ROW 10 Done schedule: FAIL (${violations.length} violation(s))`,
    );
    return violations;
  }
  const arrival = await postMoveForCard(built, built.cardId, "done");
  console.log(
    `row 10 Done schedule: genuine Done arrival todo -> done -> ${arrival.status} (expected 204)`,
  );
  if (arrival.status !== 204) {
    violations.push(
      `row 10 Done schedule: genuine Done arrival returned ${arrival.status}, expected 204 (body=${JSON.stringify(arrival.body)})`,
    );
    console.log(
      `ROW 10 Done schedule: FAIL (${violations.length} violation(s))`,
    );
    return violations;
  }

  const wireAtDone = await fetchFixtureCard(built);
  const hasSessionCount = Object.hasOwn(wireAtDone ?? {}, "sessionCount");
  const hasSessionSummaries = Object.hasOwn(
    wireAtDone ?? {},
    "sessionSummaries",
  );
  console.log(
    `row 10 Done schedule: wire hasOwn(sessionCount)=${hasSessionCount} hasOwn(sessionSummaries)=${hasSessionSummaries} (both expected false at N=1)`,
  );
  if (hasSessionCount || hasSessionSummaries) {
    violations.push(
      `row 10 Done schedule: wire card carries hasOwn(sessionCount)=${hasSessionCount} hasOwn(sessionSummaries)=${hasSessionSummaries} right after a genuine Done arrival at N=1 — both must be ABSENT`,
    );
  }

  const persistedAtDone = readCard(built.dbPath, built.cardId);
  const sessionRecordAtDone = persistedAtDone?.sessions?.find(
    (s) => s.id === built.sessionA.id,
  );
  console.log(
    `row 10 Done schedule: session.cleanupDueAt=${sessionRecordAtDone?.cleanupDueAt} card.cleanupDueAt=${persistedAtDone?.cleanupDueAt} (both expected set, non-null, after a genuine Done arrival)`,
  );
  if (sessionRecordAtDone?.cleanupDueAt == null) {
    violations.push(
      "row 10 Done schedule: the card's ONE session carries no cleanupDueAt after a genuine Done arrival",
    );
  }
  if (persistedAtDone?.cleanupDueAt == null) {
    violations.push(
      "row 10 Done schedule: card.cleanupDueAt (the active-session mirror) is not set after a genuine Done arrival",
    );
  }
  if (violations.length > 0) {
    console.log(
      `ROW 10 Done schedule: FAIL (${violations.length} violation(s))`,
    );
    return violations;
  }

  console.log(
    "row 10 Done schedule: backdating the real (session-level) cleanupDueAt on disk — same technique checkCleanupScheduleRestartFalsifiability already established — so the scheduler's own real teardown is observable within this row's runtime rather than days away",
  );
  await killAndWait(built.server?.child);
  const cardToBackdate = readCard(built.dbPath, built.cardId);
  const sessionToBackdate = cardToBackdate?.sessions?.find(
    (s) => s.id === built.sessionA.id,
  );
  if (sessionToBackdate) sessionToBackdate.cleanupDueAt = Date.now() - 5_000;
  if (cardToBackdate) cardToBackdate.cleanupDueAt = Date.now() - 5_000;
  seedFixtureCard(built.home, cardToBackdate);

  const priorTickEnv = process.env.DISPATCH_CLEANUP_TICK_MS;
  process.env.DISPATCH_CLEANUP_TICK_MS = "500";
  try {
    built.server = bootServer(built.home, { pathPrefix: built.pathPrefix });
    await waitForReady(built.port);
  } finally {
    if (priorTickEnv === undefined) delete process.env.DISPATCH_CLEANUP_TICK_MS;
    else process.env.DISPATCH_CLEANUP_TICK_MS = priorTickEnv;
  }
  console.log(
    "row 10 Done schedule: sandbox server restarted with DISPATCH_CLEANUP_TICK_MS=500 (PATH preserving the fixture's own hooks-capable stub claude, needed by row 11's subsequent fresh start) — the scheduler's own boot-time tick should pick up the ONE due session within a few ticks",
  );

  const deadline = Date.now() + CLEANUP_ISOLATION_SETTLE_TIMEOUT_MS;
  let settled;
  let sessionGone = false;
  while (Date.now() < deadline) {
    settled = readCard(built.dbPath, built.cardId);
    sessionGone =
      settled != null &&
      !(settled.sessions ?? []).some((s) => s.id === built.sessionA.id);
    if (sessionGone) break;
    await sleep(POLL_INTERVAL_MS);
  }
  console.log(
    `row 10 Done schedule: real scheduler teardown of the ONE session — settled sessionGone=${sessionGone} (sessions now=${JSON.stringify(settled?.sessions?.map((s) => s.id))})`,
  );
  if (!sessionGone) {
    violations.push(
      `row 10 Done schedule: the real scheduler tick did not tear down the card's due session within ${CLEANUP_ISOLATION_SETTLE_TIMEOUT_MS}ms`,
    );
  } else {
    const liveTmux = await tmuxListSessionNames();
    const tmuxGone = !liveTmux.includes(built.tmux.a);
    console.log(
      `row 10 Done schedule: real tmux session ${built.tmux.a} gone=${tmuxGone} after the scheduler's own real teardown`,
    );
    if (!tmuxGone) {
      violations.push(
        `row 10 Done schedule: tmux session ${built.tmux.a} is still live after the scheduler's own real teardown`,
      );
    }
  }

  console.log(
    `ROW 10 Done schedule: ${violations.length === 0 ? "PASS" : `FAIL (${violations.length} violation(s))`}`,
  );
  return violations;
}

/**
 * `KEEP-02` row 11 (manual cleanup of the card's ONLY session) against a card whose one session
 * owns a REAL git worktree. {@link PARITY_FIXTURE}'s own original session was already consumed by
 * row 10's own real scheduler-driven teardown (this row runs AFTER it, in the SAME fixture pass —
 * `96-06-PLAN.md`'s own "against ONE PARITY_FIXTURE subject" lock), so this row re-drives a
 * GENUINE real single-session start (`postStartForCard` + `waitForCardFirstStartSettled`, the
 * EXACT mechanism {@link standUpParityFixtureSession1} used for the fixture's own first session)
 * before driving the manual `/cleanup` route. The resulting session is therefore genuinely the
 * card's ONLY session, with a genuine, freshly-created real worktree, exactly what row 11's own
 * claim needs.
 * @remarks LIVE-CAUGHT, not anticipated: `card.workspace` is NOT preserved across a teardown the
 * way a first read of `finishCleanup` suggests. `workspace` is one of `PROJECTED_SESSION_FIELDS`'
 * SIX mirrored fields (`board.store.ts:202`, alongside `tmuxSession`/`ttydPort`/`hookToken`/
 * `claudeSessionId`/`workspacePath`) — `setActiveSession`'s own closing re-derivation re-projects
 * ALL SIX from whatever the (post-removal) active session now is, and after `removeSessionRecord`
 * there is none, so `card.workspace` re-derives to `undefined` too. A first attempt at this row
 * called `POST /start` with only `{ extraDirection: "" }` (mirroring
 * {@link standUpParityFixtureSession1}'s own first-start call, which relies on a card ALREADY
 * seeded with `workspace` at stand-up time) and got a real, correct 400 ("No workspace selected
 * for this ticket") — matching the real product's own behavior for a genuinely fully-cleaned
 * ticket, not a check bug. Fixed by supplying the real `folder`/`repos` payload explicitly, the
 * same request a user re-selecting a workspace after a fully torn-down ticket would send.
 * @remarks Phase 93's own criterion 4 ("cleaning the last leaves the card sessionless with no
 * active pointer") was proven by the SECOND cleanup on a two-session `WORKTREE_FIXTURE` card — a
 * card that always had a live sibling available to promote to, right up until its very last
 * removal. This row's subject never had a sibling at all, which is the sharper, previously-unproven
 * claim: `removeSessionRecord`'s own `live.sort(byRecency)[0] ?? [...card.sessions].sort(byRecency)[0]`
 * promotion fallback has NOTHING to find on a genuinely one-session-total card, so
 * `activeSessionId` must land on `undefined`, never a stale pointer at the just-removed record.
 */
async function checkParityRow11Cleanup(built) {
  const violations = [];
  console.log(
    "row 11 cleanup: Phase 93's criterion 4 proved the LAST-session claim via the SECOND cleanup on a two-session WORKTREE_FIXTURE card (a card that always had a sibling until the very end) — this row drives a card that never had one, a genuinely different subject.",
  );

  const outMove = await postMoveForCard(built, built.cardId, "todo");
  if (outMove.status !== 204) {
    violations.push(
      `row 11 cleanup: precondition move to todo returned ${outMove.status}, expected 204 (body=${JSON.stringify(outMove.body)})`,
    );
    console.log(`ROW 11 cleanup: FAIL (${violations.length} violation(s))`);
    return violations;
  }
  const startRes = await postStartForCard(built, built.cardId, {
    extraDirection: "",
    folder: join(built.home, "repos"),
    repos: [{ path: built.repoPath, base: built.repoBase }],
  });
  console.log(
    `row 11 cleanup: real single-session start (no newSession) -> ${startRes.status} (expected 202)`,
  );
  if (startRes.status !== 202) {
    violations.push(
      `row 11 cleanup: POST /start for the fresh only-session returned ${startRes.status}, expected 202 (body=${JSON.stringify(startRes.body)})`,
    );
    console.log(`ROW 11 cleanup: FAIL (${violations.length} violation(s))`);
    return violations;
  }
  const { card: settled, timedOut } = await waitForCardFirstStartSettled(
    built,
    built.cardId,
    { timeoutMs: SECOND_SESSION_SAGA_TIMEOUT_MS },
  );
  console.log(
    `row 11 cleanup: fresh start settled — tmuxSession=${settled?.tmuxSession} startError=${JSON.stringify(settled?.startError)} timedOut=${timedOut}`,
  );
  if (timedOut || settled?.startError != null || settled?.tmuxSession == null) {
    violations.push(
      `row 11 cleanup: the fresh only-session start did not settle into a live session (timedOut=${timedOut}, startError=${JSON.stringify(settled?.startError)}, tmuxSession=${settled?.tmuxSession}) — row 11's own subject cannot be built without it`,
    );
    console.log(`ROW 11 cleanup: FAIL (${violations.length} violation(s))`);
    return violations;
  }

  const freshTmux = settled.tmuxSession;
  const freshPersisted = readCard(built.dbPath, built.cardId);
  const freshSessionId = freshPersisted?.activeSessionId;
  const freshRecord = freshPersisted?.sessions?.find(
    (s) => s.id === freshSessionId,
  );
  // `workspacePath` is the per-TICKET workspace FOLDER (`types.ts`'s own doc comment), not the
  // per-REPO worktree directory itself — `worktreePath(workspacePath, repoPath)` (production's
  // own `workspace-paths.ts`, loaded live rather than re-deriving the "basename(repoPath)" join by
  // hand) is what actually names the git worktree cleanupWorkspace removes. LIVE-CAUGHT: a first
  // attempt asserted against `freshRecord.workspacePath` directly and got a real, correct
  // "registered=false" BASELINE failure — the workspace FOLDER was never itself registered as a
  // worktree, only the "alpha" subdirectory inside it is.
  const { worktreePath } = await loadWorkspacePathsAdapter();
  const freshRepoPath = freshRecord?.workspace?.repos?.[0]?.path;
  const freshWorktreePath =
    freshRecord?.workspacePath != null && freshRepoPath != null
      ? worktreePath(freshRecord.workspacePath, freshRepoPath)
      : undefined;
  console.log(
    `row 11 cleanup: fresh only-session id=${freshSessionId} tmux=${freshTmux} workspacePath=${freshRecord?.workspacePath} worktree=${freshWorktreePath} repo=${freshRepoPath}`,
  );
  if (
    freshSessionId == null ||
    freshWorktreePath == null ||
    freshRepoPath == null
  ) {
    violations.push(
      "row 11 cleanup: the fresh only-session's persisted record is missing activeSessionId/workspacePath/workspace.repos[0].path — cannot verify teardown without a real worktree path to check",
    );
    console.log(`ROW 11 cleanup: FAIL (${violations.length} violation(s))`);
    return violations;
  }
  assertUnderTmpdir(freshWorktreePath, "row 11's fresh only-session worktree");
  console.log(
    `row 11 cleanup: fresh worktree path verified structurally under tmpdir BEFORE any removal — ${freshWorktreePath}`,
  );

  const registeredBefore = await gitWorktreeListRegistered(freshRepoPath);
  const wasRegisteredBefore =
    existsSync(freshWorktreePath) &&
    registeredBefore.has(realpathSync(freshWorktreePath));
  console.log(
    `row 11 cleanup: BASELINE — worktree exists on disk=${existsSync(freshWorktreePath)} registered=${wasRegisteredBefore}`,
  );
  if (!wasRegisteredBefore) {
    violations.push(
      "row 11 cleanup: BASELINE FAILED — the fresh only-session's worktree is not registered before cleanup even runs, so its removal below would be vacuous",
    );
    console.log(`ROW 11 cleanup: FAIL (${violations.length} violation(s))`);
    return violations;
  }

  const arrival = await postMoveForCard(built, built.cardId, "done");
  console.log(
    `row 11 cleanup: move to done (cleanup's own precondition) -> ${arrival.status} (expected 204)`,
  );
  if (arrival.status !== 204) {
    violations.push(
      `row 11 cleanup: move to done before /cleanup returned ${arrival.status}, expected 204 (body=${JSON.stringify(arrival.body)})`,
    );
    console.log(`ROW 11 cleanup: FAIL (${violations.length} violation(s))`);
    return violations;
  }

  const cleanupRes = await postCleanup(built, {});
  console.log(`row 11 cleanup: POST /cleanup -> ${cleanupRes} (expected 202)`);
  if (cleanupRes !== 202) {
    violations.push(
      `row 11 cleanup: POST /cleanup returned ${cleanupRes}, expected 202`,
    );
    console.log(`ROW 11 cleanup: FAIL (${violations.length} violation(s))`);
    return violations;
  }

  const deadline = Date.now() + CLEANUP_ISOLATION_SETTLE_TIMEOUT_MS;
  let settledCard;
  let sessionGone = false;
  while (Date.now() < deadline) {
    settledCard = readCard(built.dbPath, built.cardId);
    sessionGone =
      settledCard != null &&
      !(settledCard.sessions ?? []).some((s) => s.id === freshSessionId);
    if (sessionGone) break;
    await sleep(POLL_INTERVAL_MS);
  }
  console.log(
    `row 11 cleanup: manual fan-out settled — sessionGone=${sessionGone} sessions=${JSON.stringify(settledCard?.sessions?.map((s) => s.id))}`,
  );
  if (!sessionGone) {
    violations.push(
      `row 11 cleanup: manual cleanup did not remove the only session within ${CLEANUP_ISOLATION_SETTLE_TIMEOUT_MS}ms`,
    );
    console.log(`ROW 11 cleanup: FAIL (${violations.length} violation(s))`);
    return violations;
  }

  const liveTmux = await tmuxListSessionNames();
  const tmuxGone = !liveTmux.includes(freshTmux);
  console.log(
    `row 11 cleanup: real tmux session ${freshTmux} gone=${tmuxGone} (exact-match against tmux list-sessions)`,
  );
  if (!tmuxGone) {
    violations.push(
      `row 11 cleanup: real tmux session ${freshTmux} is still live after manual cleanup`,
    );
  }

  const registeredAfter = await gitWorktreeListRegistered(freshRepoPath);
  const worktreeGoneFromDisk = !existsSync(freshWorktreePath);
  const worktreeStillRegistered = registeredAfter.has(
    existsSync(freshWorktreePath)
      ? realpathSync(freshWorktreePath)
      : freshWorktreePath,
  );
  console.log(
    `row 11 cleanup: worktree removed from disk=${worktreeGoneFromDisk} deregistered from repo=${!worktreeStillRegistered} (two SEPARATE assertions)`,
  );
  if (!worktreeGoneFromDisk) {
    violations.push(
      `row 11 cleanup: worktree directory still exists on disk — ${freshWorktreePath}`,
    );
  }
  if (worktreeStillRegistered) {
    violations.push(
      `row 11 cleanup: worktree is still registered in \`git worktree list\` — ${freshWorktreePath} (registered: ${[...registeredAfter].join(", ")})`,
    );
  }

  console.log(
    `row 11 cleanup: persisted card sessions.length=${settledCard?.sessions?.length ?? 0} (expected 0), activeSessionId=${JSON.stringify(settledCard?.activeSessionId)} (expected ABSENT — no sibling to promote to)`,
  );
  if ((settledCard?.sessions?.length ?? 0) !== 0) {
    violations.push(
      `row 11 cleanup: persisted card carries ${settledCard?.sessions?.length} session(s) after cleaning its only session, expected exactly 0`,
    );
  }
  if (settledCard?.activeSessionId !== undefined) {
    violations.push(
      `row 11 cleanup: persisted card.activeSessionId is "${settledCard?.activeSessionId}" after cleaning the ONLY session — expected ABSENT (undefined), never a pointer at the just-removed session with no sibling to promote to`,
    );
  }

  const mirrorFields = [
    "tmuxSession",
    "ttydPort",
    "hookToken",
    "workspacePath",
  ];
  const stale = mirrorFields.filter((f) => settledCard?.[f] != null);
  console.log(
    `row 11 cleanup: card-level singular mirror fields after cleanup — ${mirrorFields.map((f) => `${f}=${JSON.stringify(settledCard?.[f])}`).join(" ")} (all expected null/undefined)`,
  );
  if (stale.length > 0) {
    violations.push(
      `row 11 cleanup: card-level mirror field(s) left stale after cleanup: ${stale.join(", ")} (expected cleared, not left pointing at the removed session)`,
    );
  }

  const wireAfter = await fetchFixtureCard(built);
  const hasSessionCount = Object.hasOwn(wireAfter ?? {}, "sessionCount");
  const hasSessionSummaries = Object.hasOwn(
    wireAfter ?? {},
    "sessionSummaries",
  );
  console.log(
    `row 11 cleanup: wire hasOwn(sessionCount)=${hasSessionCount} hasOwn(sessionSummaries)=${hasSessionSummaries} (both expected false at N=1)`,
  );
  if (hasSessionCount || hasSessionSummaries) {
    violations.push(
      `row 11 cleanup: wire card carries hasOwn(sessionCount)=${hasSessionCount} hasOwn(sessionSummaries)=${hasSessionSummaries} after cleaning the only session — both must be ABSENT`,
    );
  }

  console.log(
    `ROW 11 cleanup: ${violations.length === 0 ? "PASS" : `FAIL (${violations.length} violation(s))`}`,
  );
  return violations;
}

/**
 * `--check parity-moves` (Plan 96-06, Phase 96 Wave 5): the three `KEEP-02` rows this milestone's
 * previous parity plans left for last — a drag across every column edge (row 9), the Done schedule
 * (row 10) and manual cleanup of the card's only session (row 11) — against ONE
 * {@link PARITY_FIXTURE} subject, each its own independently named verdict. Rows run in THIS
 * order deliberately: row 10's own real scheduler-driven teardown consumes
 * {@link PARITY_FIXTURE}'s original session, so row 11 (which needs a genuinely fresh only-session
 * subject regardless) runs strictly after it — see {@link checkParityRow11Cleanup}'s own JSDoc.
 */
async function checkParityMoves(built) {
  return [
    ...(await checkParityRow9Moves(built)),
    ...(await checkParityRow10DoneSchedule(built)),
    ...(await checkParityRow11Cleanup(built)),
  ];
}

/**
 * `--check group-session-guard` (`KEEP-03`, Plan 96-07). Two independently-named legs against ONE
 * {@link GROUP_SESSION_FIXTURE} stand-up (96-02's own measured census: 5 column-writing mutators
 * fanning out via `mirrorMemberColumn`, 8 single-card routes carrying the `groupedMemberError` 409
 * guard):
 *
 * - The MUTATOR leg ({@link checkGroupSessionGuardMutators}) drives all five mutators through their
 *   real entry points against the fixture's multi-session group parent, folding in the atomicity
 *   claim for `moveCardManual` as a deterministic AWAITED mutate-then-read loop (never a concurrent
 *   storm — `checkSwitchAtomicity`'s own 92-VALIDATION.md finding that a naive storm reports ZERO
 *   violations under the real regression because fire-and-forget mutations settle faster than reads
 *   can observe a torn window).
 * - The ROUTE leg ({@link checkGroupSessionGuardRoutes}) drives all eight single-card routes against
 *   a real member card, asserting the exact 409 + message text, proves the SAME well-formed request
 *   against a non-member control card does NOT 409, and carries the route-count sentinel that binds
 *   the driven-case count to a fresh source measurement of `groupedMemberError` guard call sites in
 *   `cards.route.ts` — so a ninth guarded route added later without a matching case fails this check
 *   by name instead of silently under-covering (96-02's own "seven vs eight" correction, made
 *   permanent).
 *
 * `GROUP_SESSION_FIXTURE` ships with `realSaga: false` / `worktrees: false` (96-03's own deliberate
 * design — its subject is the group/member relationship, not saga machinery). `completeStart` and
 * `attachExistingSession` can only be reached live through a genuine `/start`/`/resume` saga, so the
 * mutator leg extends the running sandbox mid-check with exactly what row 11 (96-06) already proved
 * works for a DIFFERENT fixture: a hooks-capable stub `claude` on `PATH` (a server reboot, since
 * `PATH` is inherited at spawn and cannot change under an already-running child) plus a real
 * throwaway git repo, then drives `/start` with an explicit `folder`/`repos` payload the same way
 * row 11 did. The real tmux/ttyd artifacts this creates for the fixture's THIRD session are outside
 * what the fixture's own (non-real-saga) `tearDownFixture` knows to look for — {@link
 * cleanupExtraGroupSession} tears them down explicitly before `withFixture`'s own teardown runs.
 */
async function checkGroupSessionGuard(built) {
  const violations = [];
  violations.push(...(await checkGroupSessionGuardMutators(built)));
  violations.push(...(await checkGroupSessionGuardRoutes(built)));
  return violations;
}

/**
 * Reboot {@link GROUP_SESSION_FIXTURE}'s sandbox server with a hooks-capable stub `claude` planted
 * on `PATH` — the fixture's own stand-up boots with no stub at all. `PATH` is inherited at process
 * spawn and cannot be changed on an already-running child, so this KILLS and re-boots the server
 * rather than merely writing the file, passing `{ pathPrefix: built.pathPrefix }` explicitly the
 * same way `checkParityRow10DoneSchedule` (96-06) had to once it live-caught that
 * {@link restartServer}'s own pathPrefix-less reboot is unsafe for a check that spawns a NEW
 * `claude` process after the reboot. Session records already seeded to disk by
 * {@link standUpGroupSessionFixture} survive the reboot unchanged (the in-memory `Map` reloads from
 * the same `board.db`).
 */
async function rebootGroupFixtureWithStubClaude(built) {
  await killAndWait(built.server?.child);
  neutralizeSandboxLinearApiKey(built);
  built.pathPrefix = writeHooksCapableStubClaudeBinary(built.home);
  built.server = bootServer(built.home, { pathPrefix: built.pathPrefix });
  await waitForReady(built.port);
  console.log(
    `group-session-guard: rebooted with hooks-capable stub claude on PATH — ${join(built.pathPrefix, "claude")}`,
  );
}

/**
 * SAFETY (live-caught mid-plan): force the sandbox's own `config.json` to carry an empty
 * `linearApiKey` before the reboot above, so the `sync-linear` route case below can NEVER reach
 * `syncCardToLinear`'s real `claude -p ...` subprocess spawn — a live run of this check observed a
 * non-empty `linearApiKey` surviving into a freshly-seeded sandbox `HOME` on at least one boot
 * (root cause not fully isolated; `orchestrationConfig` is loaded once per boot from
 * `<HOME>/.dispatch/config.json`, `os.homedir()`-derived, and should default to `linearApiKey: ""`
 * per `bootstrap/config.ts`'s own `CONFIG_TEMPLATE` — see 96-07-SUMMARY.md for the incident and
 * why this is a belt-and-suspenders write rather than a root-cause fix). Left the real `claude -p`
 * process it produced hung against the stub's own "not --version" infinite-loop branch, spawned
 * via a REAL Linear MCP prompt; killed manually, no Linear-side or `board.db` side effect observed.
 * A no-op if the file does not yet exist or already carries an empty key.
 */
function neutralizeSandboxLinearApiKey(built) {
  const configPath = join(built.home, DISPATCH_DIR_NAME, "config.json");
  if (!existsSync(configPath)) return;
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(configPath, "utf8"));
  } catch {
    return;
  }
  if (parsed.linearApiKey) {
    parsed.linearApiKey = "";
    writeFileSync(configPath, JSON.stringify(parsed, null, 2) + "\n");
    console.log(
      `group-session-guard: SAFETY — neutralized a non-empty linearApiKey found in the sandbox config (${configPath}) before booting; the sync-linear route case must never be able to reach a real network/claude call`,
    );
  }
}

/** `GET /cards/:id` for both {@link GROUP_SESSION_FIXTURE} member cards, parallel-fetched. */
async function fetchGroupMemberCards(built) {
  const [aRes, bRes] = await Promise.all([
    fetchCardById(built, built.memberAId),
    fetchCardById(built, built.memberBId),
  ]);
  return {
    a: aRes.status === 200 ? aRes.body?.card : undefined,
    b: bRes.status === 200 ? bRes.body?.card : undefined,
  };
}

/**
 * Assert the parent AND both members landed on `expectedColumn`, read entirely through the wire
 * (`GET /cards/:id`, never the seeded fixture object) — the parent's own read and the two members'
 * reads are three SEPARATE round trips, so a bug in one resolver can never mask a bug in another.
 * Also asserts the parent's own `sessionCount` matches `expectedSessionCount` (the collision
 * `KEEP-03` names would show up here, as a mirroring operation disturbing the parent's own session
 * set) and that neither member carries any session-level field of its own.
 */
/**
 * Print a NAMED per-mutator verdict line (`MUTATOR NAME: PASS` / `FAIL (n)` plus the violations
 * added since `beforeCount`) — so `96-VERDICT.md` gets a five-row table rather than one collapsed
 * pass/fail, and so a break confined to ONE mutator's own code is provably independent of the other
 * four (each still prints its own PASS in the same run).
 */
function printMutatorVerdict(name, beforeCount, afterCount, violations) {
  const own = violations.slice(beforeCount, afterCount);
  const verdict = own.length === 0 ? "PASS" : `FAIL (${own.length})`;
  console.log(`GROUP-SESSION-GUARD mutator [${name}]: ${verdict}`);
  for (const v of own) console.log(`  ${v}`);
}

async function assertGroupMirror(
  built,
  label,
  expectedColumn,
  expectedSessionCount,
  violations,
) {
  const { status: pStatus, body: pBody } = await fetchCardById(
    built,
    built.cardId,
  );
  const parent = pStatus === 200 ? pBody?.card : undefined;
  const { a, b } = await fetchGroupMemberCards(built);
  console.log(
    `group-session-guard mutator [${label}]: parent.column=${parent?.column} memberA.column=${a?.column} memberB.column=${b?.column} parent.sessionCount=${parent?.sessionCount}`,
  );
  if (parent?.column !== expectedColumn) {
    violations.push(
      `${label}: parent column expected "${expectedColumn}", actual ${JSON.stringify(parent?.column)}`,
    );
  }
  if (a?.column !== expectedColumn) {
    violations.push(
      `${label}: member A (${built.memberAId}) column expected "${expectedColumn}" (mirrored from the parent), actual ${JSON.stringify(a?.column)} — UNMIRRORED`,
    );
  }
  if (b?.column !== expectedColumn) {
    violations.push(
      `${label}: member B (${built.memberBId}) column expected "${expectedColumn}" (mirrored from the parent), actual ${JSON.stringify(b?.column)} — UNMIRRORED`,
    );
  }
  if (
    expectedSessionCount != null &&
    (parent?.sessionCount ?? 1) !== expectedSessionCount
  ) {
    violations.push(
      `${label}: parent sessionCount expected ${expectedSessionCount}, actual ${JSON.stringify(parent?.sessionCount)} — a member-mirroring operation must never disturb the parent's own session set`,
    );
  }
  for (const [tag, member] of [
    ["A", a],
    ["B", b],
  ]) {
    if (member == null) continue;
    if (member.tmuxSession != null) {
      violations.push(
        `${label}: member ${tag} carries a tmuxSession (${JSON.stringify(member.tmuxSession)}) — a group member must never own session-level fields`,
      );
    }
    if (member.activeSession != null) {
      violations.push(
        `${label}: member ${tag} carries an activeSession (${JSON.stringify(member.activeSession)}) — a group member must never own session-level fields`,
      );
    }
    if (member.groupId !== built.cardId) {
      violations.push(
        `${label}: member ${tag}'s groupId expected "${built.cardId}", actual ${JSON.stringify(member.groupId)}`,
      );
    }
  }
  return { parent, a, b };
}

/**
 * Kill the REAL tmux session and REAL ttyd process a genuine `/start`/`/resume` saga created for
 * the fixture's third session — artifacts entirely outside what {@link GROUP_SESSION_FIXTURE}'s own
 * (non-real-saga) `tearDownFixture` knows to look for, since it only ever inspects `sessionKeys`
 * `a`/`b`. Reads the CURRENT persisted record (not the stale `sessionRecord` snapshot the caller
 * captured earlier) so a tmux/ttyd identity that changed underneath (e.g. a real resume minting a
 * new tmux name) is still torn down correctly. The real worktree/repo this session's saga created
 * lives entirely under `built.home` (both `folder` and `repos[0].path` were seeded there), so
 * `tearDownFixture`'s own blanket `rmSync(built.home, ...)` removes it — no separate
 * `worktreeRemove` call is needed here.
 */
async function cleanupExtraGroupSession(built, sessionId, violations) {
  if (sessionId == null) return;
  const current = readCard(built.dbPath, built.cardId)?.sessions?.find(
    (s) => s.id === sessionId,
  );
  if (current?.tmuxSession) {
    await tmuxKillSessionExact(current.tmuxSession);
  }
  if (current?.ttydPort && (await isPortListening(current.ttydPort))) {
    for (const pid of await pidsListeningOnPort(current.ttydPort)) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // already gone
      }
    }
  }
  console.log(
    `group-session-guard: extra-session cleanup — tmux=${current?.tmuxSession ?? "(none)"} ttydPort=${current?.ttydPort ?? "(none)"}`,
  );
  if (current?.tmuxSession) {
    const stillLive = (await tmuxListSessionNames()).includes(
      current.tmuxSession,
    );
    if (stillLive) {
      violations.push(
        `cleanup: extra group session's real tmux "${current.tmuxSession}" still present after kill-session`,
      );
    }
  }
}

/**
 * The MUTATOR leg of `--check group-session-guard`: drives all FIVE column-writing mutators through
 * their real entry points against {@link GROUP_SESSION_FIXTURE}'s multi-session (>= 2) group
 * parent, asserting on EVERY step that both real members mirrored the parent's new column, the
 * parent's own session set was undisturbed (except where the mutator itself legitimately grows it —
 * `completeStart`), and neither member gained any session-level field. The five are driven in an
 * order chosen so EVERY official assertion sees a genuine column CHANGE (`applyMarker`/`flipBack`
 * setup calls between them exist only to reach a legal source column for the next official mutator —
 * logged, but not double-counted as a second row):
 *
 * 1. `moveCardManual` — `POST /move`, folded into the atomicity loop below.
 * 2. `applyMarker` — a real `Stop` hook POST (`in_review -> needs_input`).
 * 3. `completeStart` — a real THIRD session landing on the parent via `POST /start
 *    {newSession:true}` (`needs_input -> in_progress`).
 * 4. `attachExistingSession` — a real tmux kill + the real 3-strike detector + `POST /resume`
 *    (`agent_done -> in_progress`).
 * 5. `flipBack` — a real `UserPromptSubmit` hook POST (`needs_input -> in_progress`).
 *
 * @remarks THE ATOMICITY ASSERTION (`moveCardManual`). A DETERMINISTIC AWAITED mutate-then-read
 * loop, never a concurrent storm: `checkSwitchAtomicity`'s own finding (92-VALIDATION.md) is that a
 * storm of concurrent switches/reads reports ZERO violations against the real regression, because
 * fire-and-forget mutations settle faster than concurrent reads can ever observe a torn window — a
 * dead instrument by this milestone's own definition. `moveCardManual` runs inside `enqueue`'s
 * single-writer promise chain (`board.store.ts:731`, `return this.queue`): the mutator writes
 * `card.column` AND fans out to every member via `mirrorMemberColumn` in the SAME synchronous
 * closure, with no `await` between the two writes, and the route's own `POST /move` handler does not
 * send its response until that whole chained promise has resolved. This means the in-memory state
 * transitions from "parent+members all old" to "parent+members all new" in one synchronous step with
 * no possible intermediate window — so a read taken immediately after the AWAITED POST resolves can
 * only ever observe one of those two states, never a disagreement between them. Running this
 * mutate-then-read pair repeatedly (never merely once) is what gives the assertion teeth: a
 * hypothetical regression that broke atomicity only probabilistically would still be caught by
 * enough repetitions, without needing concurrency to manufacture the race.
 */
/**
 * The card-level flat `hookToken` mirror for {@link GROUP_SESSION_FIXTURE}'s parent, re-read FRESH
 * from disk on every call — the exact field `setActiveSession`'s projection chokepoint keeps in
 * sync with whichever session is CURRENTLY active (`steps.ts#startClaude`'s own real mint/register
 * sequence targets it), so it is always correct for the active session regardless of which
 * mint/resume call last wrote it. Preferred over reading a captured session record's own
 * `hookToken` field, which can go stale across a later resume.
 */
function activeHookToken(built) {
  return readCard(built.dbPath, built.cardId)?.hookToken;
}

/**
 * POST a hook event using the CURRENT `activeHookToken`, re-reading it and retrying on a 401 until
 * `timeoutMs` elapses — LIVE-CAUGHT: immediately after a real `/start {newSession:true}` saga
 * settles on the wire (`sessionCount` incremented, `provisioningStep` cleared), the freshly minted
 * session's own `hookToken` is not always ALREADY resolvable through `resolveHookToken` on the
 * very first hook POST — a real, reproducible small window between the wire reporting the saga
 * settled and the in-memory hook-token registry (`hook-tokens.ts`, populated by
 * `steps.ts#startClaude`'s own `registerHookToken` call) being consultable by a request racing in
 * from outside the process. Treated as an eventually-consistent condition to poll for, the same
 * posture every other settle-then-act step in this file already takes, rather than asserted on the
 * first attempt.
 */
async function postHookWithRetry(built, body, { timeoutMs }) {
  const deadline = Date.now() + timeoutMs;
  let status;
  let attempts = 0;
  let lastToken;
  for (;;) {
    attempts += 1;
    lastToken = activeHookToken(built);
    status = await postHook(built, lastToken, body);
    if (status === 204 || Date.now() >= deadline) break;
    await sleep(POLL_INTERVAL_MS);
  }
  return { status, attempts, token: lastToken };
}

async function checkGroupSessionGuardMutators(built) {
  const violations = [];

  await rebootGroupFixtureWithStubClaude(built);
  await seedFixtureRepo(built);

  // --- 1. moveCardManual, driven as the deterministic awaited atomicity loop. ---
  const ATOMICITY_ITERATIONS = 12;
  let column = "in_progress";
  for (let i = 0; i < ATOMICITY_ITERATIONS; i++) {
    const target = column === "in_progress" ? "in_review" : "in_progress";
    const moveRes = await postMoveForCard(built, built.cardId, target);
    if (moveRes.status !== 204) {
      violations.push(
        `moveCardManual (atomicity iteration ${i}): POST /move -> ${moveRes.status}, expected 204 (body=${JSON.stringify(moveRes.body)})`,
      );
      break;
    }
    await assertGroupMirror(
      built,
      `moveCardManual (atomicity iteration ${i})`,
      target,
      2,
      violations,
    );
    column = target;
  }
  console.log(
    `group-session-guard mutator moveCardManual: drove ${ATOMICITY_ITERATIONS} AWAITED mutate-then-read cycles alternating in_progress/in_review — parent+both members read in agreement on every single one`,
  );
  printMutatorVerdict("moveCardManual", 0, violations.length, violations);
  if (column !== "in_review") {
    const fix = await postMoveForCard(built, built.cardId, "in_review");
    if (fix.status !== 204) {
      violations.push(
        `moveCardManual: could not settle the atomicity loop on "in_review" for the sequence below, got ${fix.status}`,
      );
    }
  }

  // --- 2. applyMarker: in_review -> needs_input, via session A's real hook token. ---
  const beforeApplyMarker = violations.length;
  const statusApplyA = await postHook(
    built,
    built.sessionA.token,
    stopBodyWithReason("group-mutator-applyMarker"),
  );
  console.log(
    `group-session-guard mutator applyMarker: POST /api/hook/claude (session A, Stop NEEDS_INPUT) -> ${statusApplyA} (expected 204)`,
  );
  if (statusApplyA !== 204) {
    violations.push(
      `applyMarker: POST /api/hook/claude (session A, Stop NEEDS_INPUT) -> ${statusApplyA}, expected 204`,
    );
  }
  await assertGroupMirror(built, "applyMarker", "needs_input", 2, violations);
  printMutatorVerdict(
    "applyMarker",
    beforeApplyMarker,
    violations.length,
    violations,
  );

  // --- 3. completeStart: needs_input -> in_progress, via a REAL third session on the parent. ---
  let sessionCId;
  const beforeCompleteStart = violations.length;
  try {
    const startRes = await postStartForCard(built, built.cardId, {
      extraDirection: "",
      newSession: true,
      folder: join(built.home, "repos"),
      repos: [{ path: built.repoPath, base: built.repoBase }],
    });
    console.log(
      `group-session-guard mutator completeStart: POST /start {newSession:true} -> ${startRes.status} (expected 202, body=${JSON.stringify(startRes.body)})`,
    );
    if (startRes.status !== 202) {
      violations.push(
        `completeStart: POST /start {newSession:true} -> ${startRes.status}, expected 202 (body=${JSON.stringify(startRes.body)})`,
      );
    } else {
      const { card: settled3, timedOut } = await waitForNthSessionSettled(
        built,
        3,
        { timeoutMs: SECOND_SESSION_SAGA_TIMEOUT_MS },
      );
      console.log(
        `completeStart: third session settled — sessionCount=${settled3?.sessionCount} startError=${JSON.stringify(settled3?.startError)} timedOut=${timedOut}`,
      );
      if (
        timedOut ||
        settled3?.startError != null ||
        (settled3?.sessionCount ?? 0) < 3
      ) {
        violations.push(
          `completeStart: the real third-session start did not settle (timedOut=${timedOut}, startError=${JSON.stringify(settled3?.startError)}, sessionCount=${settled3?.sessionCount})`,
        );
      }
    }
    await assertGroupMirror(
      built,
      "completeStart",
      "in_progress",
      3,
      violations,
    );
    printMutatorVerdict(
      "completeStart",
      beforeCompleteStart,
      violations.length,
      violations,
    );

    const afterStart = readCard(built.dbPath, built.cardId);
    const knownIds = new Set([built.sessionA.id, built.sessionB.id]);
    const sessionC = afterStart?.sessions?.find((s) => !knownIds.has(s.id));
    if (sessionC == null) {
      violations.push(
        "completeStart: could not resolve the new (third) session's persisted record on disk — cannot drive attachExistingSession/flipBack against it",
      );
      return violations;
    }
    sessionCId = sessionC.id;
    console.log(
      `completeStart: new session C id=${sessionC.id} tmux=${sessionC.tmuxSession}`,
    );

    // --- setup only (moveCardManual, already asserted above): in_progress -> needs_input. ---
    // A manual move, never a hook POST: session C's own hook channel is what the NEXT step exists
    // to fix (see the remark below), so setup here must not depend on it being valid yet.
    const beforeAttachExisting = violations.length;
    const setupMove = await postMoveForCard(built, built.cardId, "needs_input");
    if (setupMove.status !== 204) {
      violations.push(
        `setup (manual move, reaching needs_input for the attachExistingSession leg below): POST /move -> ${setupMove.status}, expected 204 (body=${JSON.stringify(setupMove.body)})`,
      );
    }
    await assertGroupMirror(
      built,
      "moveCardManual (setup for attachExistingSession)",
      "needs_input",
      3,
      violations,
    );

    // --- 4. attachExistingSession: needs_input -> in_progress. ---
    // LIVE-CAUGHT (real product finding, recorded for 96-11 in the SUMMARY): `attachExistingSession`
    // is NOT reached through `/resume` at all — `/resume` calls the COLUMN-PRESERVING
    // `store.resumeSession` (`resume-session.ts`), a DIFFERENT store method. `attachExistingSession`
    // is only reached through `start-session.ts`'s "already live" branch: `POST /start` (no
    // `newSession`) when `hasSession('=dsp-<identifier>')` is already true. 96-02's own census
    // phrase ("Resume path completing onto an existing session") reads as the literal `/resume`
    // route; it is not — it is `/start`'s reattach-onto-an-already-running-tmux branch. This also
    // surfaced a SEPARATE, genuine hook-token misattribution: `steps.ts#startClaude`'s
    // `store.mintHookChannel` call resolves its target via the card's CURRENT `activeSessionId`,
    // but `reserveNewSession` deliberately does NOT promote the newly reserved session to active
    // until `completeStart` succeeds (`D-NOPROMOTE-ON-RESERVE`) — so for a `newSession:true` start,
    // the freshly minted hook token is registered against the OLD (still-active) session, not the
    // new one being launched, and the new session's real hook channel is unauthenticated
    // (`resolveHookToken` 401s) until something else (e.g. a resume) mints it a token correctly.
    // Named KEEP-03 finding, recorded in 96-07-SUMMARY.md for 96-11's remediation budget.
    //
    // `card.sessionLost` is a WHOLE-CARD flag, DERIVED true only when EVERY session the card owns
    // is dead (`board.store.ts#markSessionLost`'s own doc) — its sibling-promotion branch means
    // killing only the ACTIVE session's tmux on a multi-session card PROMOTES a live sibling
    // instead, so all THREE of the fixture's real sessions must die to reach `sessionLost=true` at
    // all; A and B are no longer needed by any later assertion in this sequence.
    await tmuxKillSessionExact(built.tmux.a);
    await tmuxKillSessionExact(built.tmux.b);
    await tmuxKillSessionExact(sessionC.tmuxSession);
    const liveAfterKill = await tmuxListSessionNames();
    console.log(
      `attachExistingSession: killed ALL THREE real tmux sessions (a=${built.tmux.a}, b=${built.tmux.b}, C=${sessionC.tmuxSession}) — any still in tmux list-sessions after kill=${JSON.stringify(liveAfterKill.filter((n) => [built.tmux.a, built.tmux.b, sessionC.tmuxSession].includes(n)))}`,
    );
    let sawLostC = false;
    const lostDeadline = Date.now() + LIVENESS_POLL_TIMEOUT_MS;
    while (Date.now() < lostDeadline) {
      const wire = await fetchFixtureCard(built);
      if (wire?.sessionLost === true) {
        sawLostC = true;
        break;
      }
      await sleep(LIVENESS_POLL_INTERVAL_MS);
    }
    console.log(
      `attachExistingSession: real 3-strike sessionLost observed=${sawLostC}`,
    );
    if (!sawLostC) {
      violations.push(
        "attachExistingSession: killing all three real tmux sessions did not produce a real card-level sessionLost=true within the liveness timeout",
      );
    }

    // Step A: a real `/resume` — `store.resumeSession`, column-preserving, revives a BARE-named
    // real tmux ("dsp-<identifier>") and (since no tmux existed) mints session C a FRESH,
    // CORRECTLY-attributed hook token (mint targets `card.activeSessionId`, already C by now, with
    // no reserve-then-promote gap in this path). Necessary precursor, not the mutator under test.
    const resumeRes = await postResumeForCard(built, built.cardId);
    console.log(
      `attachExistingSession (precursor): POST /resume -> ${resumeRes.status} (expected 202)`,
    );
    if (resumeRes.status !== 202) {
      violations.push(
        `attachExistingSession (precursor): POST /resume -> ${resumeRes.status}, expected 202 (body=${JSON.stringify(resumeRes.body)})`,
      );
    } else {
      const { card: resumed, timedOut: resumeTimedOut } =
        await waitForResumeSettled(built, {
          timeoutMs: RESTART_REPL_TIMEOUT_SETTLE_MS,
        });
      console.log(
        `attachExistingSession (precursor): resume settled — sessionLost=${resumed?.sessionLost} tmuxSession=${resumed?.tmuxSession} column=${resumed?.column} (expected preserved "needs_input") timedOut=${resumeTimedOut}`,
      );
      if (
        resumeTimedOut ||
        resumed?.sessionLost === true ||
        resumed?.tmuxSession == null
      ) {
        violations.push(
          `attachExistingSession (precursor): the real resume did not settle into a live session (timedOut=${resumeTimedOut}, sessionLost=${resumed?.sessionLost}, tmuxSession=${resumed?.tmuxSession})`,
        );
      }
      if (resumed?.column !== "needs_input") {
        violations.push(
          `attachExistingSession (precursor): store.resumeSession is documented column-preserving, expected column to stay "needs_input", actual ${JSON.stringify(resumed?.column)}`,
        );
      }
    }

    // Step B: the REAL `attachExistingSession` entry point — `POST /start` with NO `newSession`,
    // now that the bare-named tmux resume just created is genuinely alive, so
    // `start-session.ts`'s "already live" branch fires. `card.workspace` already resolves (set by
    // the earlier real `/start {newSession:true}` saga), so an empty body is well-formed here.
    const reattachRes = await postStartForCard(built, built.cardId, {
      extraDirection: "",
    });
    console.log(
      `attachExistingSession: POST /start (no newSession, tmux already live) -> ${reattachRes.status} (expected 202, body=${JSON.stringify(reattachRes.body)})`,
    );
    if (reattachRes.status !== 202) {
      violations.push(
        `attachExistingSession: POST /start (reattach branch) -> ${reattachRes.status}, expected 202 (body=${JSON.stringify(reattachRes.body)})`,
      );
    }
    // The route returns 202 fire-and-forget (`void startSession(...)`) — `attachExistingSession`'s
    // own mutation lands moments later, asynchronously. Poll for the column to settle rather than
    // asserting immediately against the just-sent response.
    let attachSettled = false;
    const attachDeadline = Date.now() + RESTART_REPL_TIMEOUT_SETTLE_MS;
    while (Date.now() < attachDeadline) {
      const wire = await fetchFixtureCard(built);
      if (wire?.column === "in_progress") {
        attachSettled = true;
        break;
      }
      await sleep(POLL_INTERVAL_MS);
    }
    console.log(
      `attachExistingSession: settled (column reached "in_progress")=${attachSettled}`,
    );
    await assertGroupMirror(
      built,
      "attachExistingSession",
      "in_progress",
      3,
      violations,
    );
    printMutatorVerdict(
      "attachExistingSession",
      beforeAttachExisting,
      violations.length,
      violations,
    );

    // --- setup only (applyMarker again): in_progress -> needs_input, via the RESUMED token. ---
    const beforeFlipBack = violations.length;
    const needsC = await postHookWithRetry(
      built,
      stopBodyWithReason("group-mutator-setup-for-flipBack"),
      { timeoutMs: RESTART_REPL_TIMEOUT_SETTLE_MS },
    );
    console.log(
      `setup (applyMarker NEEDS_INPUT via the resumed session C): POST /api/hook/claude -> ${needsC.status} after ${needsC.attempts} attempt(s) (expected 204)`,
    );
    if (needsC.status !== 204) {
      violations.push(
        `setup (applyMarker NEEDS_INPUT via the resumed session C, reaching a flipBack source): POST /api/hook/claude -> ${needsC.status} after ${needsC.attempts} attempt(s), expected 204`,
      );
    }
    await assertGroupMirror(
      built,
      "applyMarker (setup for flipBack)",
      "needs_input",
      3,
      violations,
    );

    // --- 5. flipBack: needs_input -> in_progress, via a real UserPromptSubmit hook POST. ---
    const flipStatus = await postPromptSubmit(built, activeHookToken(built));
    console.log(
      `group-session-guard mutator flipBack: POST /api/hook/claude (UserPromptSubmit) -> ${flipStatus} (expected 204)`,
    );
    if (flipStatus !== 204) {
      violations.push(
        `flipBack: POST /api/hook/claude (UserPromptSubmit) -> ${flipStatus}, expected 204`,
      );
    }
    await assertGroupMirror(built, "flipBack", "in_progress", 3, violations);
    printMutatorVerdict(
      "flipBack",
      beforeFlipBack,
      violations.length,
      violations,
    );
  } finally {
    await cleanupExtraGroupSession(built, sessionCId, violations);
  }

  const verdict =
    violations.length === 0
      ? "PASS"
      : `FAIL (${violations.length} violation(s))`;
  console.log(
    `GROUP-SESSION-GUARD mutators (5/5 driven: moveCardManual, applyMarker, completeStart, attachExistingSession, flipBack): ${verdict}`,
  );
  return violations;
}

/**
 * Count `groupedMemberError` guard CALL sites in `src/server/routes/cards.route.ts`, freshly
 * re-read from disk and comment-stripped (both `/* *\/` and `//` styles — {@link
 * stripCommentsPerLine}, the exact filter 96-02's own census needed once a `//`-commented-out guard
 * had to be detected), excluding the function's own definition line. This is the count leg of the
 * route-count sentinel: `checkGroupSessionGuardRoutes` asserts this equals the number of routes it
 * drives, so a ninth guard added later without a matching driven case fails the check by name.
 */
function countGroupedMemberErrorGuardSites() {
  const file = join(REPO_ROOT, "src", "server", "routes", "cards.route.ts");
  const stripped = stripCommentsPerLine(readFileSync(file, "utf8"));
  const wordRe = /(?<![A-Za-z0-9_$])groupedMemberError(?![A-Za-z0-9_$])/g;
  const sites = [];
  stripped.forEach((line, idx) => {
    const matches = [...line.matchAll(wordRe)];
    if (matches.length === 0) return;
    if (/function\s+groupedMemberError\s*\(/.test(line)) return;
    sites.push({ line: idx + 1, count: matches.length, text: line.trim() });
  });
  const count = sites.reduce((sum, s) => sum + s.count, 0);
  return { count, sites };
}

/** POST `body` to `path(cardId)` on the sandbox, returning `{ status, body }`. */
async function postCardRoute(built, cardId, path, body) {
  const res = await fetch(`http://127.0.0.1:${built.port}${path(cardId)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const parsed = await res.json().catch(() => undefined);
  return { status: res.status, body: parsed };
}

/**
 * The eight single-card routes carrying the `groupedMemberError` 409 guard (96-02's own measured
 * census), each with a WELL-FORMED body for that route — one that reaches PAST the route's own
 * body-shape validation, so a 400 from a malformed body can never masquerade as the guard firing.
 * Bodies are chosen so the SAME well-formed request, sent to the fresh non-member control card
 * (`todo`, no workspace, no sessions), resolves to a NON-409 status through real business logic —
 * never a status this table has to special-case per card, and never one that requires a full real
 * saga to reach (`/start`/`/resume`/`/terminal`/`/session` all resolve on their own early
 * precondition checks against a sessionless, workspaceless card).
 */
const GROUP_ROUTE_CASES = [
  {
    name: "move",
    label: "POST /cards/:id/move",
    path: (id) => `/api/cards/${id}/move`,
    body: { column: "in_review" },
  },
  {
    name: "start",
    label: "POST /cards/:id/start",
    path: (id) => `/api/cards/${id}/start`,
    body: { extraDirection: "" },
  },
  {
    name: "resume",
    label: "POST /cards/:id/resume",
    path: (id) => `/api/cards/${id}/resume`,
    body: {},
  },
  {
    name: "terminal",
    label: "POST /cards/:id/terminal",
    path: (id) => `/api/cards/${id}/terminal`,
    body: {},
  },
  {
    name: "session",
    label: "POST /cards/:id/session",
    path: (id) => `/api/cards/${id}/session`,
    body: { sessionId: "nonexistent-session-id" },
  },
  {
    name: "open-editor",
    label: "POST /cards/:id/open-editor",
    path: (id) => `/api/cards/${id}/open-editor`,
    body: { editor: "cursor" },
  },
  {
    name: "cleanup",
    label: "POST /cards/:id/cleanup",
    path: (id) => `/api/cards/${id}/cleanup`,
    body: {},
  },
  {
    name: "sync-linear",
    label: "POST /cards/:id/sync-linear",
    path: (id) => `/api/cards/${id}/sync-linear`,
    body: {},
  },
];

/**
 * The ROUTE leg of `--check group-session-guard`: drives all EIGHT {@link GROUP_ROUTE_CASES} against
 * a real member card (`built.memberAId`) AND a fresh, real, non-member control card (created via a
 * real `POST /cards`), asserting per route:
 *
 * - the member request returns EXACTLY 409, carrying `groupedMemberError`'s own message text
 *   (`card is grouped under <parentId> — act on the group card`), never merely a 4xx;
 * - the control request, given the IDENTICAL well-formed body, does NOT return 409 — proving the
 *   member's 409 came from the group guard specifically, not from a route that refuses everything.
 *
 * The `cleanup` case needs the control card in `done` (its own business-rule 409 otherwise fires for
 * ANY non-Done card, member or not, which would make the control leg indistinguishable from the
 * guard) — driven there via two real, legal `/move` calls before that one case runs; every other
 * case is state-insensitive by design (see {@link GROUP_ROUTE_CASES}'s own doc comment).
 *
 * Then the ROUTE-COUNT SENTINEL: {@link countGroupedMemberErrorGuardSites} re-measures
 * `cards.route.ts` fresh from disk and asserts the count equals `GROUP_ROUTE_CASES.length` — the
 * assertion that makes 96-02's "seven vs eight" correction permanent rather than a one-time fix.
 */
async function checkGroupSessionGuardRoutes(built) {
  const violations = [];

  const control = await createRollbackStartCard(built);
  console.log(
    `group-session-guard routes: control (non-member) card = ${control.cardId} (${control.identifier})`,
  );

  const GROUPED_MEMBER_ERROR_TEXT = `card is grouped under ${built.cardId} — act on the group card`;

  for (const testCase of GROUP_ROUTE_CASES) {
    if (testCase.name === "cleanup") {
      const toReview = await postMoveForCard(
        built,
        control.cardId,
        "in_review",
      );
      const toDone = await postMoveForCard(built, control.cardId, "done");
      console.log(
        `group-session-guard routes: control -> in_review (${toReview.status}) -> done (${toDone.status}), setting up the cleanup case`,
      );
      if (toReview.status !== 204 || toDone.status !== 204) {
        violations.push(
          `route ${testCase.label}: could not drive the control card to "done" for the cleanup case (in_review=${toReview.status}, done=${toDone.status})`,
        );
      }
    }

    const memberRes = await postCardRoute(
      built,
      built.memberAId,
      testCase.path,
      testCase.body,
    );
    const controlRes = await postCardRoute(
      built,
      control.cardId,
      testCase.path,
      testCase.body,
    );
    console.log(
      `group-session-guard route [${testCase.name}] ${testCase.label}: member -> ${memberRes.status} (expect 409 groupedMemberError), control -> ${controlRes.status} (expect NOT 409, body=${JSON.stringify(controlRes.body)})`,
    );

    if (memberRes.status !== 409) {
      violations.push(
        `route ${testCase.label}: member card returned ${memberRes.status}, expected EXACTLY 409 (body=${JSON.stringify(memberRes.body)})`,
      );
    } else if (memberRes.body?.error !== GROUPED_MEMBER_ERROR_TEXT) {
      violations.push(
        `route ${testCase.label}: member card 409 body.error=${JSON.stringify(memberRes.body?.error)}, expected exactly ${JSON.stringify(GROUPED_MEMBER_ERROR_TEXT)}`,
      );
    }
    if (controlRes.status === 409) {
      violations.push(
        `route ${testCase.label}: the IDENTICAL well-formed request against the non-member control card ALSO returned 409 (body=${JSON.stringify(controlRes.body)}) — cannot distinguish the group guard firing from a route that refuses everything`,
      );
    }
  }

  const { count: sourceCount, sites } = countGroupedMemberErrorGuardSites();
  console.log(
    `group-session-guard sentinel: source guard call sites in cards.route.ts = ${sourceCount}, routes driven by this check = ${GROUP_ROUTE_CASES.length}`,
  );
  if (sourceCount !== GROUP_ROUTE_CASES.length) {
    violations.push(
      `sentinel: cards.route.ts carries ${sourceCount} groupedMemberError guard call site(s) but this check drives ${GROUP_ROUTE_CASES.length} routes — a route was added or removed without a matching case here (sites: ${JSON.stringify(sites)})`,
    );
  }

  const verdict =
    violations.length === 0
      ? "PASS"
      : `FAIL (${violations.length} violation(s))`;
  console.log(
    `GROUP-SESSION-GUARD routes (${GROUP_ROUTE_CASES.length}/${GROUP_ROUTE_CASES.length} driven, sentinel ${sourceCount}==${GROUP_ROUTE_CASES.length}): ${verdict}`,
  );
  return violations;
}

/**
 * `--check hook-token-attribution` (Phase 96 plan 11, closes finding `F-96-A`): stands up
 * {@link HOOK_ATTRIBUTION_FIXTURE} — session A minted through the real first-start saga, session B
 * through a real `POST /start {newSession:true}` — and proves BOTH halves of the fix directly
 * against the live server, never by inspection: (1) session B's OWN persisted `hookToken` is set
 * and authenticates a hook POST on the FIRST, un-retried attempt (before this fix it was
 * `undefined` — the mint landed on session A, the card's still-active pointer, instead), and (2)
 * session A's ORIGINAL token — captured at stand-up, before session B ever existed — still
 * authenticates afterward (before this fix, `previousToken` read the card's flat mirror rather
 * than the target session's own prior token and revoked session A's still-live credential as a
 * side effect of minting session B's).
 */
async function checkHookTokenAttribution(built) {
  const violations = [];
  const sessionAToken = built.sessionA?.token;
  console.log(
    `hook-token-attribution: session A id=${built.sessionA?.id} token present=${sessionAToken != null}`,
  );
  if (sessionAToken == null) {
    violations.push(
      "hook-token-attribution: session A's own token was never captured at stand-up — cannot prove anything about session B's attribution without a known-good baseline",
    );
    return violations;
  }

  const persisted = readCard(built.dbPath, built.cardId);
  const persistedSessions = persisted?.sessions ?? [];
  const sessionB = persistedSessions.find((s) => s.id !== built.sessionA?.id);
  if (persistedSessions.length !== 2 || sessionB == null) {
    violations.push(
      `hook-token-attribution: expected exactly 2 persisted sessions with session B resolvable, got ${JSON.stringify(persistedSessions.map((s) => ({ id: s.id, tmuxSession: s.tmuxSession })))}`,
    );
    return violations;
  }
  console.log(
    `hook-token-attribution: session B id=${sessionB.id} tmux=${sessionB.tmuxSession} own hookToken present=${sessionB.hookToken != null}`,
  );

  // 1. Session B's OWN record must carry its own token — never left unset because the mint
  // landed on session A (the still-active pointer at mint time) instead.
  if (sessionB.hookToken == null) {
    violations.push(
      "hook-token-attribution: session B's own persisted hookToken is unset — F-96-A: the newSession:true launch's mint must target the reserved session itself, not the still-active sibling",
    );
    return violations;
  }
  if (sessionB.hookToken === sessionAToken) {
    violations.push(
      "hook-token-attribution: session B's own persisted hookToken is IDENTICAL to session A's — the two sessions must never share one credential",
    );
  }

  // 2. Session B's token authenticates on the FIRST, un-retried POST — proving the mint/register
  // pair landed on B at launch time, never requiring a later resume to repair it.
  const statusB = await postHook(
    built,
    sessionB.hookToken,
    stopBodyWithReason("hook-token-attribution-B"),
  );
  console.log(
    `hook-token-attribution: session B's own token, first un-retried POST -> ${statusB} (expected 204)`,
  );
  if (statusB !== 204) {
    violations.push(
      `hook-token-attribution: session B's own token did not authenticate on the first attempt -> ${statusB}, expected 204`,
    );
  }

  // 3. Session A's ORIGINAL token — captured before session B ever existed — must still
  // authenticate: minting B's credential must never revoke an unrelated sibling's live one.
  const statusA = await postHook(
    built,
    sessionAToken,
    stopBodyWithReason("hook-token-attribution-A-still-live"),
  );
  console.log(
    `hook-token-attribution: session A's ORIGINAL token, POST after B's mint -> ${statusA} (expected 204)`,
  );
  if (statusA !== 204) {
    violations.push(
      `hook-token-attribution: session A's original token no longer authenticates after session B's mint -> ${statusA}, expected 204 — a newSession:true launch must never revoke an unrelated sibling's still-live credential`,
    );
  }

  return violations;
}

/**
 * Escape the five XML-significant characters, the same set `service.ts`'s own (unexported)
 * `xmlEscape` applies, so a corrupted `ProgramArguments` entry this check writes is well-formed
 * plist body. A local copy, not an import, this harness must read/write the plist independently of
 * the code under test, matching {@link extractProgramArguments}'s own reasoning below.
 */
function xmlEscape(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Decode the same five XML entities {@link xmlEscape} applies, mirroring `service.ts`'s own
 * (unexported) `decodeXmlEntities`.
 */
function decodeXmlEntities(value) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/**
 * Extract the ordered `ProgramArguments` string values from a rendered plist. No XML parser: the
 * plist schema is generated exclusively by `buildPlist` (`service.ts`), so a narrow scan of its own
 * known shape is enough, mirroring `reinstall-sim.mjs`'s own local copy of the same primitive
 * (`service.ts`'s `extractProgramArguments` is not exported).
 * @returns The decoded `<string>` values inside `ProgramArguments`, empty when the key or its
 * `<array>` block is missing.
 */
function extractProgramArguments(xml) {
  const keyIndex = xml.indexOf("<key>ProgramArguments</key>");
  if (keyIndex === -1) return [];
  const arrayStart = xml.indexOf("<array>", keyIndex);
  const arrayEnd = xml.indexOf("</array>", arrayStart);
  if (arrayStart === -1 || arrayEnd === -1) return [];
  const block = xml.slice(arrayStart, arrayEnd);
  const values = [];
  const stringRe = /<string>([\s\S]*?)<\/string>/g;
  let match;
  while ((match = stringRe.exec(block)) !== null) {
    values.push(decodeXmlEntities(match[1]));
  }
  return values;
}

/**
 * Rewrite the SECOND `<string>` entry (index 1, the `cliEntry` slot `buildPlist` renders right
 * after `nodePath`) inside a rendered plist's `ProgramArguments` array, simulating the exact stale
 * path a reinstall that moves the resolved binary leaves behind.
 */
function corruptSecondProgramArgument(xml, newValue) {
  const keyIndex = xml.indexOf("<key>ProgramArguments</key>");
  if (keyIndex === -1) {
    throw new Error("rendered plist has no ProgramArguments key");
  }
  const arrayStart = xml.indexOf("<array>", keyIndex);
  const arrayEnd = xml.indexOf("</array>", arrayStart);
  if (arrayStart === -1 || arrayEnd === -1) {
    throw new Error("rendered plist has no ProgramArguments array");
  }
  const block = xml.slice(arrayStart, arrayEnd);
  const stringRe = /<string>([\s\S]*?)<\/string>/g;
  const matches = [...block.matchAll(stringRe)];
  if (matches.length < 2) {
    throw new Error(
      `rendered plist's ProgramArguments has ${matches.length} <string> entries, expected at least 2`,
    );
  }
  const second = matches[1];
  const rewrittenBlock =
    block.slice(0, second.index) +
    `<string>${xmlEscape(newValue)}</string>` +
    block.slice(second.index + second[0].length);
  return xml.slice(0, arrayStart) + rewrittenBlock + xml.slice(arrayEnd);
}

/**
 * The final non-empty line of `text`. `healServicePlist` writes its own log line to stdout before
 * the `node -e` wrapper's `console.log(r)` prints the return value on the line after it, so the
 * return value is always the LAST line, never the whole trimmed output (mirrors `reinstall-sim.mjs`'s
 * own `lastLine`).
 */
function lastLine(text) {
  const lines = text.split("\n").filter((l) => l.trim() !== "");
  return lines.length > 0 ? lines[lines.length - 1].trim() : "";
}

/**
 * `--check reinstall-session` (PERSIST-04, Phase 97 plan 05): a real `dsp` tmux plus ttyd session,
 * standing before this function runs, must still be held by the same ttyd pid after (1) a stale
 * plist a simulated reinstall would leave behind is healed and (2) the backend restarts. The board's
 * own `GET /api/board` wire is the witness both before and after, never a store record read
 * directly, matching this file's header's "unfalsifiable" warning about store-only liveness claims.
 *
 * Never calls real `launchctl` in any form (not even `print`): the plist is obtained only through
 * `node dist/server/bootstrap/cli.js service install --print` (stdout-only, zero side effects, same
 * instrument `reinstall-sim.mjs` uses) and healed only through `healServicePlist({reload:false})`'s
 * file-only path, both spawned with `HOME` set to the fixture's own sandbox home so every path they
 * touch resolves inside it.
 *
 * `DISPATCH_REINSTALL_SESSION_BREAK` selects one of two proven-failing directions, read once at the
 * top so a break-mode run can never be mistaken for a real one:
 * - `kill-ttyd`: the fixture's real ttyd is SIGTERM'd after the heal and before the restart, so the
 *   post-restart pid/adoption/wire assertions (steps 6-8) must fail.
 * - `skip-heal`: the heal call itself is skipped, so the on-disk plist stays stale and step 4's own
 *   assertions must fail.
 * Any other non-empty value is a configuration error, not a silent no-op.
 */
async function checkReinstallSession(built) {
  const violations = [];
  const breakMode = process.env.DISPATCH_REINSTALL_SESSION_BREAK || undefined;
  if (
    breakMode !== undefined &&
    breakMode !== "kill-ttyd" &&
    breakMode !== "skip-heal"
  ) {
    throw new Error(
      `unknown DISPATCH_REINSTALL_SESSION_BREAK "${breakMode}", expected "kill-ttyd" or "skip-heal"`,
    );
  }
  console.log(
    `reinstall-session: break mode = ${breakMode ?? "(none, real run)"}`,
  );

  // Step 1: the pre-restart ttyd pid, the baseline every adoption claim below is measured against.
  const pidBefore = (await pidsListeningOnPort(built.ttyd.a.port))[0];
  console.log(
    `reinstall-session: step 1 pre-restart ttyd port ${built.ttyd.a.port} pid=${pidBefore}`,
  );
  if (pidBefore == null) {
    violations.push(
      `step 1: could not resolve a pre-restart lsof PID for ttyd port ${built.ttyd.a.port}`,
    );
    return violations;
  }

  // Step 2: the board's own wire, before anything is touched.
  const cardBefore = await fetchFixtureCard(built);
  console.log(
    `reinstall-session: step 2 wire activeSession.id=${cardBefore?.activeSession?.id} ttydPort=${cardBefore?.activeSession?.ttydPort} sessionLost=${cardBefore?.sessionLost}`,
  );
  if (cardBefore?.activeSession?.id !== built.sessionA.id) {
    violations.push(
      `step 2: wire activeSession.id expected ${built.sessionA.id}, actual ${cardBefore?.activeSession?.id}`,
    );
  }
  if (cardBefore?.activeSession?.ttydPort !== built.ttyd.a.port) {
    violations.push(
      `step 2: wire activeSession.ttydPort expected ${built.ttyd.a.port}, actual ${cardBefore?.activeSession?.ttydPort}`,
    );
  }
  if (cardBefore?.sessionLost === true) {
    violations.push(
      `step 2: wire reported sessionLost=true before any restart, the fixture never started dead`,
    );
  }

  // Step 3: simulate what a reinstall leaves behind, a plist rendered by the CURRENT build with its
  // cliEntry rewritten to a path that no longer exists, written under the fixture's sandbox home.
  const cliJsPath = join(REPO_ROOT, "dist", "server", "bootstrap", "cli.js");
  const freshRender = execFileSync(
    process.execPath,
    [cliJsPath, "service", "install", "--print"],
    { env: { ...process.env, HOME: built.home }, encoding: "utf8" },
  );
  const freshArgs = extractProgramArguments(freshRender);
  const expectedCliEntry = freshArgs[1];
  console.log(
    `reinstall-session: step 3 fresh cli.js path = ${expectedCliEntry}`,
  );
  if (!expectedCliEntry) {
    violations.push(
      `step 3: fresh \`service install --print\` render produced no ProgramArguments[1]`,
    );
    return violations;
  }
  const stalePath = "/nonexistent/dispatch/dist/server/bootstrap/cli.js";
  const stalePlist = corruptSecondProgramArgument(freshRender, stalePath);
  const plistPath = join(
    built.home,
    "Library",
    "LaunchAgents",
    "com.dispatch.app.plist",
  );
  mkdirSync(dirname(plistPath), { recursive: true });
  writeFileSync(plistPath, stalePlist);
  console.log(
    `reinstall-session: step 3 wrote a stale plist to ${plistPath} (cli.js -> ${stalePath})`,
  );

  // Step 4: heal it exactly as `service restart` would, minus the launchd reload, unless the
  // skip-heal break mode is proving this exact step falls over without it.
  let healOutcome;
  if (breakMode !== "skip-heal") {
    const healEntry = join(
      REPO_ROOT,
      "dist",
      "server",
      "services",
      "orchestration",
      "service.js",
    );
    const healScript =
      `import(${JSON.stringify(pathToFileURL(healEntry).href)})` +
      `.then((m) => m.healServicePlist({ reload: false }))` +
      `.then((r) => console.log(r))`;
    const healResult = execFileSync(
      process.execPath,
      ["--input-type=module", "-e", healScript],
      { env: { ...process.env, HOME: built.home }, encoding: "utf8" },
    );
    healOutcome = lastLine(healResult);
  } else {
    console.log(
      `reinstall-session: step 4 SKIPPED by DISPATCH_REINSTALL_SESSION_BREAK=skip-heal, the plist is left stale on purpose`,
    );
  }
  console.log(
    `reinstall-session: step 4 healServicePlist outcome = ${healOutcome ?? "(heal not run)"}`,
  );
  if (healOutcome !== "rewritten") {
    violations.push(
      `step 4: healServicePlist outcome expected "rewritten", actual ${JSON.stringify(healOutcome ?? null)}`,
    );
  }
  const healedArgs = extractProgramArguments(readFileSync(plistPath, "utf8"));
  if (healedArgs[1] !== expectedCliEntry) {
    violations.push(
      `step 4: on-disk plist cli.js path is "${healedArgs[1]}", expected "${expectedCliEntry}"`,
    );
  }

  if (breakMode === "kill-ttyd") {
    console.log(
      `reinstall-session: DISPATCH_REINSTALL_SESSION_BREAK=kill-ttyd, killing the real ttyd (pid ${built.ttyd.a.child?.pid}) before the restart`,
    );
    await killAndWait(built.ttyd.a.child);
  }

  // Step 5: the service-restart half, tmux and its real ttyd (unless just killed above) untouched.
  await restartServer(built);

  // Step 6: the same ttyd pid, or this was a respawn, not the adoption PERSIST-04 claims.
  const pidAfter = (await pidsListeningOnPort(built.ttyd.a.port))[0];
  console.log(
    `reinstall-session: step 6 post-restart ttyd port ${built.ttyd.a.port} pid=${pidAfter}`,
  );
  if (pidAfter !== pidBefore) {
    violations.push(
      `step 6: ttyd port ${built.ttyd.a.port} lsof PID changed across restart, before=${pidBefore} after=${pidAfter} (a respawn, not the adoption PERSIST-04 claims)`,
    );
  }

  // Step 7: the boot's own [reconcile] line, the same ttyd-adopted count parse checkReconcileStage1 uses.
  const reconcileLines = (built.server?.logLines ?? []).filter((l) =>
    l.includes("[reconcile]"),
  );
  for (const line of reconcileLines) {
    console.log(`reinstall-session: server log: ${line}`);
  }
  const adoptedMatch = reconcileLines
    .map((l) => l.match(/ttyd adopted: (\d+)/))
    .find((m) => m);
  const adoptedCount = adoptedMatch ? Number(adoptedMatch[1]) : undefined;
  if (adoptedCount !== 1) {
    violations.push(
      `step 7: [reconcile] boot line reported ttyd adopted=${adoptedCount}, expected 1`,
    );
  }

  // Step 8: the board's own wire again, the session must be reported attached, not lost.
  const cardAfter = await fetchFixtureCard(built);
  console.log(
    `reinstall-session: step 8 wire activeSession.id=${cardAfter?.activeSession?.id} ttydPort=${cardAfter?.activeSession?.ttydPort} sessionLost=${cardAfter?.sessionLost}`,
  );
  if (cardAfter?.activeSession?.id !== cardBefore?.activeSession?.id) {
    violations.push(
      `step 8: wire activeSession.id expected ${cardBefore?.activeSession?.id} (the same session as before the restart), actual ${cardAfter?.activeSession?.id}`,
    );
  }
  if (cardAfter?.activeSession?.ttydPort !== built.ttyd.a.port) {
    violations.push(
      `step 8: wire activeSession.ttydPort expected ${built.ttyd.a.port}, actual ${cardAfter?.activeSession?.ttydPort}`,
    );
  }
  if (cardAfter?.sessionLost === true) {
    violations.push(
      `step 8: wire reported sessionLost=true after boot reconciliation, PERSIST-04 requires the session reported attached again`,
    );
  }

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
  "artifact-attribution": () =>
    withFixture(
      "artifact-attribution",
      checkArtifactAttribution,
      SECOND_SESSION_FIXTURE,
    ),
  "inherit-ancestry": () =>
    withFixture(
      "inherit-ancestry",
      checkInheritAncestry,
      SECOND_SESSION_FIXTURE,
    ),
  "inherit-parent-intact": () =>
    withFixture(
      "inherit-parent-intact",
      checkInheritParentIntact,
      SECOND_SESSION_FIXTURE,
    ),
  "inherit-parentage": () =>
    withFixture(
      "inherit-parentage",
      checkInheritParentage,
      SECOND_SESSION_FIXTURE,
    ),
  "inherit-depth": () =>
    withFixture("inherit-depth", checkInheritDepth, SECOND_SESSION_FIXTURE),
  "parity-fixture": checkParityFixture,
  "parity-lifecycle": () =>
    withFixture("parity-lifecycle", checkParityLifecycle, PARITY_FIXTURE),
  "parity-recovery": () =>
    withFixture("parity-recovery", checkParityRecovery, PARITY_FIXTURE),
  "parity-moves": () =>
    withFixture("parity-moves", checkParityMoves, PARITY_FIXTURE),
  "group-session-guard": () =>
    withFixture(
      "group-session-guard",
      checkGroupSessionGuard,
      GROUP_SESSION_FIXTURE,
    ),
  "hook-token-attribution": () =>
    withFixture(
      "hook-token-attribution",
      checkHookTokenAttribution,
      HOOK_ATTRIBUTION_FIXTURE,
    ),
  "reinstall-session": () =>
    withFixture(
      "reinstall-session",
      checkReinstallSession,
      SINGLE_SESSION_FIXTURE,
    ),
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
