/**
 * Downgrade-safety instrument (`SESS-05`, dev/ops tooling, NOT test code): imports no test
 * framework, asserts nothing via an assertion library, lives outside src/ — the same category as
 * check-invariants.mjs, migration-diff-v3.mjs, and session-liveness-v3.mjs.
 *
 * It answers the two questions the store's downgrade guards claim to answer, and it answers them
 * with TWO GENUINELY DIFFERENT BUILDS rather than an argument or an emulation. Leg 1 materializes
 * the actually-published `v2.9.0` release from the git tag, compiles it, and boots THAT binary
 * against a sandbox board written in the post-migration shape; the drift it causes is measured off
 * disk, not asserted from reading its source. Leg 2 writes a schema version from the future and
 * checks that this build refuses to open the board at all, changing nothing on disk.
 *
 * WHY AN OLD BUILD IS RUN RATHER THAN SIMULATED: a hand-written stand-in for v2.9's writer would
 * encode this file's BELIEF about what the old build does, and the whole reason `SESS-05` exists is
 * that a belief about a downgrade held for a whole release without anyone running one. The old
 * release needs no fixture author's cooperation to produce the hazard; two of its ordinary boot
 * paths do it unprompted. {@link assertOldReleaseShape} additionally verifies that the tree actually
 * compiled is one with no session entity in it, so "an old build" is a checked property of the
 * artifact rather than a label attached to it.
 *
 * NON-TAUTOLOGY, AND WHY THE FIXTURE SET IS TWO CARDS. Leg 1 refuses to grade the repair unless the
 * old build actually caused drift first ({@link assertHazardOccurred}) — without that gate, an old
 * build that failed to boot leaves the board trivially consistent and the repair is reported as
 * working having never run. That gate alone is not enough, though, and the first draft of this file
 * proved it: built on the session-lost card alone, it reported a clean PASS with the downgrade
 * repair DELETED, because the current build's own `reconcileSessions()` heals that particular drift
 * for entirely unrelated reasons. So the fixture set carries a second, DISCRIMINATING card that no
 * other boot path can touch — see {@link FIXTURES} — and every field the old build did not write is
 * carried as a CONTROL and checked to be preserved, so a repair that simply overwrote all six would
 * fail here rather than pass for the wrong reason. Removing either guard must move a named field on
 * a named card, not merely turn something red.
 *
 * SANDBOX SAFETY IS SCOPED TO STATE ON DISK PLUS THE `:4700` PROBE, NOT TO EVERY PROCESS ON THE
 * MACHINE. `assertSandboxSafe` enforces the database and the port; `assertNoLiveService` covers the
 * one machine-wide process hazard (see the accepted side effect below). Every sandbox HOME lives
 * under `os.tmpdir()` with a `dispatch-downgrade-guard-v3-` basename, verified structurally; the
 * sandbox port is asserted never to be 4700; and the real `~/.dispatch/board.db`'s mtime and size
 * are recorded before this script does anything and again after it finishes — a mismatch is a loud
 * non-zero-exit failure, not a warning. This harness never writes to `~/.dispatch/`.
 *
 * KNOWN, ACCEPTED SIDE EFFECT (T-90-19, the same acceptance migration-diff-v3.mjs and
 * session-liveness-v3.mjs carry): booting either server runs `reconcileSessions()`, which sweeps
 * `dsp`-fingerprinted ttyd processes MACHINE-WIDE — not scoped by HOME. `assertNoLiveService()` is
 * what makes that acceptable: it refuses to run at all while anything answers on `:4700`.
 *
 * The frontend dev-server proxy is never used: it hardcodes its dev-mode targets to the user's
 * real, live dispatch port. Only production builds are booted, and the current one is COMPILED
 * first ({@link assertBuilt}) so the verdict is always a property of the current `src/` — a `dist`
 * left over from an earlier commit otherwise reports today's fixes as absent, blaming source that
 * already reads correctly.
 *
 * Usage:
 *   node scripts/downgrade-guard-v3.mjs              both legs
 *   node scripts/downgrade-guard-v3.mjs --leg drift  only the older-build drift/repair leg
 *   node scripts/downgrade-guard-v3.mjs --leg newer   only the newer-schema refusal leg
 *
 * Exit codes: 0 every check PASS. 1 a setup/build/sandbox-safety error, an unproduced hazard, a
 * failed drift/repair or refusal check, or the live board.db changing.
 */
import { spawn, execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  realpathSync,
  rmSync,
  statSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir, homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST_ENTRY = join(REPO_ROOT, "dist", "server", "bootstrap", "index.js");
const BOARD_STORE_REL = join("src", "server", "store", "board.store.ts");
const SHARED_TYPES_REL = join("src", "shared", "types.ts");

/**
 * The package script {@link assertBuilt} and {@link buildOldRelease} both shell out to, so the two
 * builds can never be compiled by two literals that drift apart.
 */
const BUILD_SERVER_SCRIPT = "build:server";

/**
 * The published release leg 1 downgrades TO. A tag, never a branch or a commit range: it must name
 * a build a user could actually still be running, and it must be immutable so a cached compile of
 * it stays valid. If the tag is gone, leg 1 fails loudly rather than falling back to a stand-in.
 */
const OLD_RELEASE_TAG = "v2.9.0";

const SANDBOX_PORT = 47833;
const SANDBOX_PREFIX = "dispatch-downgrade-guard-v3-";
const DISPATCH_DIR_NAME = ".dispatch";

const POLL_INTERVAL_MS = 100;
const READY_TIMEOUT_MS = 30_000;
const DRAIN_TIMEOUT_MS = 3_000;
const KILL_TIMEOUT_MS = 5_000;

/** The six flat session fields whose agreement with the active session record IS the subject. */
const PROJECTION_FIELDS = [
  "tmuxSession",
  "ttydPort",
  "hookToken",
  "claudeSessionId",
  "workspacePath",
  "workspace",
];

/**
 * The two cards leg 1 seeds, and — the part that matters — the DIFFERENT jobs they do.
 *
 * `dgv-lost` is CORROBORATING only. The old release's boot-time reconcile marks it session-lost,
 * clearing three flat fields, which is the most visible form of the hazard. But the current build's
 * own reconcile independently heals that exact drift: it iterates SESSION records, finds one naming
 * a tmux pane that is not live, and clears it through the projection chokepoint. Deleting the
 * downgrade repair entirely leaves this card looking perfectly repaired, so a leg built on it alone
 * would report PASS while measuring nothing — which is what a first draft of this harness did.
 *
 * `dgv-todo` is the DISCRIMINATING card. It sits in To Do carrying a stale `ttydPort` and owns a
 * session with NO `tmuxSession`, so `reconcileSessions()` never even enumerates it
 * (`sessionsWithTmux()` filters on a non-null `tmuxSession`, and To Do is skipped besides). The old
 * release clears its flat `ttydPort` in `hydrateFromParsed` — an unconditional To Do write (ROBU-01)
 * that needs no live process to fire — while the session record keeps the port. Nothing at boot in
 * the current build touches that disagreement except the downgrade repair, so this card is the one
 * whose verdict moves when the repair is removed. It is also the exact wedge
 * docs/ARCHITECTURE.md#session-projection-chokepoint records as reachable: a session claiming a
 * ttyd port the card does not have renders a terminal pane that never connects.
 */
const FIXTURES = [
  {
    id: "dgv-lost",
    identifier: "DGV-1",
    column: "in_progress",
    role: "corroborating",
    why: "the current build's reconcile heals this drift independently, so its PASS proves nothing on its own",
    fields: [
      "tmuxSession",
      "ttydPort",
      "hookToken",
      "claudeSessionId",
      "workspacePath",
      "workspace",
    ],
    expectDrifted: ["tmuxSession", "ttydPort", "hookToken"],
  },
  {
    id: "dgv-todo",
    identifier: "DGV-2",
    column: "todo",
    role: "discriminating",
    why: "nothing at boot but the downgrade repair can reconcile a To Do card's session record",
    fields: ["ttydPort", "claudeSessionId", "workspacePath", "workspace"],
    expectDrifted: ["ttydPort"],
  },
];

/**
 * Sandbox HOME config carries only a hardcoded, obviously-fake placeholder key — never the real
 * `~/.dispatch/config.json`'s. Both legs seed cards directly via node:sqlite and never need one.
 */
const FAKE_LINEAR_API_KEY = "downgrade-guard-v3-harness-fake-key-never-real";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * The structural guarantee behind "never touches the user's real board.db or port 4700": called
 * before any filesystem write or child-process spawn touching a sandbox path. Throws (never
 * silently degrades) if any check fails.
 * @remarks Its scope is exactly the four checks below — port, real-HOME identity, tmpdir
 * containment, basename prefix. PROCESS state is deliberately outside that scope; see
 * {@link assertNoLiveService} and the file header's accepted side effect.
 */
function assertSandboxSafe(dir) {
  if (SANDBOX_PORT === 4700) {
    throw new Error(
      "SANDBOX_PORT must never equal 4700 — that is the user's live dispatch instance.",
    );
  }
  if (dir === homedir()) {
    throw new Error(
      "sandbox path must never equal the real $HOME — refusing to proceed.",
    );
  }
  if (!dir.startsWith(tmpdir())) {
    throw new Error(
      `sandbox path ${dir} must live under ${tmpdir()} — refusing to proceed.`,
    );
  }
  if (!basename(dir).startsWith(SANDBOX_PREFIX)) {
    throw new Error(
      `sandbox path ${dir} must have a basename starting with "${SANDBOX_PREFIX}" — refusing to proceed.`,
    );
  }
}

/**
 * Fail closed while the user's real service is up (`WR-08`). Re-run at the top of every leg rather
 * than once per process, so a leg started after the service came back still refuses.
 */
async function assertNoLiveService() {
  try {
    const res = await fetch("http://127.0.0.1:4700/api/board");
    await res.body?.cancel().catch(() => {});
    throw new Error(
      "WR-08: a live dispatch service answered on :4700 — refusing to boot sandbox servers while " +
        "the user's real service is up. The machine-wide ttyd sweep a boot triggers cannot " +
        "distinguish this harness's side effects from the live service's (adoptAndSweep " +
        "fingerprints on argv shape).",
    );
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("WR-08")) throw err;
  }
}

function makeSandboxHome(label) {
  const home = join(tmpdir(), `${SANDBOX_PREFIX}${label}-${process.pid}`);
  assertSandboxSafe(home);
  rmSync(home, { recursive: true, force: true });
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

function dbPathFor(home) {
  return join(home, DISPATCH_DIR_NAME, "board.db");
}

/**
 * Memoized result of the one current-build compile per process — see {@link assertBuilt}.
 */
let serverBuild = null;

/**
 * Compile the current server, then confirm the entry point exists. Compiling unconditionally makes
 * the stale-`dist` class structurally impossible rather than merely detectable: this harness boots
 * `dist`, never `src`, and three sibling harnesses in this milestone shipped gated on `dist` merely
 * EXISTING, so they could boot a build that did not contain the code under test.
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
        `src/ and any verdict would describe code you are not running:\n${detail || err.message}`,
    );
  }
  if (!existsSync(DIST_ENTRY)) {
    throw new Error(
      `Missing ${DIST_ENTRY} after a successful \`npm run ${BUILD_SERVER_SCRIPT}\`.`,
    );
  }
  serverBuild = { durationMs: Date.now() - startedAt };
  console.log(
    `preflight: compiled src/ -> dist/ via \`npm run ${BUILD_SERVER_SCRIPT}\` in ${serverBuild.durationMs}ms — every current-build boot below runs current source`,
  );
  return serverBuild;
}

/**
 * The migration target the store compiles with, read out of `src/` rather than duplicated here.
 * Leg 2 needs a version strictly ABOVE it; a hardcoded literal would keep testing `2` after a
 * future bump made `2` a version the store migrates TO rather than refuses, quietly turning the
 * refusal leg into a migration leg. A missing constant is a missing subject and fails loudly.
 */
function readSessionSchemaVersion() {
  const source = readFileSync(join(REPO_ROOT, BOARD_STORE_REL), "utf8");
  const m = source.match(/const SESSION_SCHEMA_VERSION = (\d+);/);
  if (!m) {
    throw new Error(
      `could not read SESSION_SCHEMA_VERSION from ${BOARD_STORE_REL} — the refusal leg's subject ` +
        `is missing or renamed, so it cannot produce a verdict.`,
    );
  }
  return Number(m[1]);
}

/**
 * Verify the tree about to be compiled as "the old build" really is one that predates the session
 * entity. Without this, leg 1's whole premise rests on a tag name: point {@link OLD_RELEASE_TAG} at
 * a release that already had the entity and the leg would boot a build that maintains the mirror
 * correctly, observe no drift, and the hazard gate would report a setup failure with no explanation
 * of why.
 */
function assertOldReleaseShape(treeRoot) {
  const store = readFileSync(join(treeRoot, BOARD_STORE_REL), "utf8");
  const types = readFileSync(join(treeRoot, SHARED_TYPES_REL), "utf8");
  const problems = [];
  if (store.includes("SESSION_SCHEMA_VERSION")) {
    problems.push(
      `${BOARD_STORE_REL} declares SESSION_SCHEMA_VERSION — this tree already has the boot migration`,
    );
  }
  if (store.includes("setActiveSession")) {
    problems.push(
      `${BOARD_STORE_REL} declares setActiveSession — this tree already has the projection chokepoint`,
    );
  }
  if (types.includes("activeSessionId")) {
    problems.push(
      `${SHARED_TYPES_REL} mentions activeSessionId — this tree already knows the session entity`,
    );
  }
  if (problems.length > 0) {
    throw new Error(
      `${OLD_RELEASE_TAG} is not a pre-session-entity build, so it cannot produce the downgrade ` +
        `hazard leg 1 exists to measure:\n  ${problems.join("\n  ")}`,
    );
  }
  console.log(
    `preflight: ${OLD_RELEASE_TAG} verified pre-session-entity — no SESSION_SCHEMA_VERSION, no setActiveSession, no activeSessionId`,
  );
}

/**
 * Materialize {@link OLD_RELEASE_TAG} into tmpdir, install it, and compile its server; return the
 * entry point. Uses `git archive` rather than `git worktree`, deliberately: extracting a tar leaves
 * the working repository's git state completely untouched, where a worktree would register an entry
 * that a failed run could strand.
 * @remarks Cached across runs under a tag-keyed tmpdir path, because break-proving this harness
 * means running it several times and `npm ci` is the slow half. The cache is safe because a tag is
 * immutable; it is re-validated by {@link assertOldReleaseShape} on every run regardless.
 */
function buildOldRelease() {
  const treeRoot = join(
    tmpdir(),
    `${SANDBOX_PREFIX}release-${OLD_RELEASE_TAG}`,
  );
  assertSandboxSafe(treeRoot);
  const entry = join(treeRoot, "dist", "server", "bootstrap", "index.js");
  if (existsSync(entry)) {
    assertOldReleaseShape(treeRoot);
    console.log(
      `preflight: reusing cached ${OLD_RELEASE_TAG} build at ${entry}`,
    );
    return entry;
  }
  const startedAt = Date.now();
  rmSync(treeRoot, { recursive: true, force: true });
  mkdirSync(treeRoot, { recursive: true });
  const tarPath = `${treeRoot}.tar`;
  try {
    const tar = execFileSync(
      "git",
      ["archive", "--format=tar", OLD_RELEASE_TAG],
      { cwd: REPO_ROOT, maxBuffer: 512 * 1024 * 1024 },
    );
    writeFileSync(tarPath, tar);
    execFileSync("tar", ["-xf", tarPath, "-C", treeRoot], { stdio: "pipe" });
  } catch (err) {
    throw new Error(
      `could not materialize ${OLD_RELEASE_TAG} — leg 1 needs the published release to downgrade ` +
        `to and will not substitute a stand-in for it: ${err.message}`,
    );
  } finally {
    rmSync(tarPath, { force: true });
  }
  assertOldReleaseShape(treeRoot);
  try {
    execFileSync("npm", ["ci", "--no-audit", "--no-fund"], {
      cwd: treeRoot,
      stdio: "pipe",
    });
    execFileSync("npm", ["run", BUILD_SERVER_SCRIPT], {
      cwd: treeRoot,
      stdio: "pipe",
    });
  } catch (err) {
    const detail = [err.stdout?.toString(), err.stderr?.toString()]
      .filter(Boolean)
      .join("\n")
      .trim();
    throw new Error(
      `could not build ${OLD_RELEASE_TAG} (npm ci may need network on a cold cache):\n${detail || err.message}`,
    );
  }
  if (!existsSync(entry)) {
    throw new Error(`Missing ${entry} after building ${OLD_RELEASE_TAG}.`);
  }
  console.log(
    `preflight: built ${OLD_RELEASE_TAG} from the git tag in ${Date.now() - startedAt}ms -> ${entry}`,
  );
  return entry;
}

/**
 * Spawn a production server against `home`, capturing stdout+stderr. The capture is not a
 * convenience: the repair's own log line and the refusal's message are half of what the two legs
 * grade, and a store that repaired silently would be a different behaviour from the one documented.
 * @remarks The entry path is resolved through {@link realpathSync} before it is handed to `node`.
 * Both bootstraps only run `main()` when `import.meta.url === pathToFileURL(process.argv[1]).href`,
 * and `import.meta.url` is always the REALPATH — so on macOS, where `os.tmpdir()` is the symlink
 * `/var/folders/…` to `/private/var/folders/…`, spawning the old release straight out of tmpdir
 * makes that comparison false. The process then starts, defines its server, runs nothing, and exits
 * 0 with no output, which reads as a build that booted and did nothing rather than as one that
 * never booted.
 */
function spawnServer(home, entry) {
  const child = spawn("node", [realpathSync(entry)], {
    env: { ...process.env, HOME: home, NODE_ENV: "production" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (d) => (output += d.toString()));
  child.stderr.on("data", (d) => (output += d.toString()));
  child.once("close", () => (child.__closed = true));
  Object.defineProperty(child, "output", { get: () => output });
  return child;
}

/** Poll until the child serves `/api/board`, exits on its own, or the deadline passes. */
async function waitForOutcome(child) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      const drainDeadline = Date.now() + DRAIN_TIMEOUT_MS;
      while (!child.__closed && Date.now() < drainDeadline) await sleep(20);
      return {
        outcome: "exited",
        code: child.exitCode,
        signal: child.signalCode,
      };
    }
    try {
      const res = await fetch(`http://127.0.0.1:${SANDBOX_PORT}/api/board`);
      await res.body?.cancel();
      if (res.status === 200) return { outcome: "ready" };
    } catch {
      // server not listening yet — keep polling
    }
    await sleep(POLL_INTERVAL_MS);
  }
  return { outcome: "timeout" };
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
 * Boot `entry` against `home`, wait for it to serve, kill it, and read the resulting board back
 * through a fresh direct connection. Boot + kill + reopen (never reading through a still-live
 * server's connection) mirrors migration-diff-v3.mjs's own idiom.
 */
async function bootAndRead(label, home, entry) {
  const child = spawnServer(home, entry);
  const pid = child.pid;
  let result;
  try {
    result = await waitForOutcome(child);
  } finally {
    await killAndWait(child);
  }
  if (result.outcome !== "ready") {
    throw new Error(
      `${label}: server (pid ${pid}) never served /api/board — outcome=${result.outcome} ` +
        `code=${result.code ?? "n/a"} signal=${result.signal ?? "n/a"}\n${child.output}`,
    );
  }
  const path = dbPathFor(home);
  return {
    pid,
    output: child.output,
    cards: readCards(path),
    meta: readMeta(path),
  };
}

/** Read every card row as a `Map<id, card>` via a read-only direct connection. */
function readCards(path) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const map = new Map();
    for (const row of db.prepare("SELECT data FROM cards").all()) {
      const card = JSON.parse(row.data);
      map.set(card.id, card);
    }
    return map;
  } finally {
    db.close();
  }
}

/** Read the single meta row (id=0) as a parsed object, or `{}` when absent. */
function readMeta(path) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const row = db.prepare("SELECT data FROM meta WHERE id = 0").get();
    return row ? JSON.parse(row.data) : {};
  } finally {
    db.close();
  }
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

/**
 * Boot the current build once against an empty sandbox home purely to create a real schema, then
 * overwrite the cards and meta rows directly (perf-board.mjs's seedDoneCards idiom). Seeding
 * through raw SQL rather than through the API is what lets a leg write a board shape — a schema
 * version from the future, or a card in the exact post-migration steady state — that no live code
 * path would produce on request.
 */
async function seedBoard(home, cards, meta) {
  const warmup = spawnServer(home, DIST_ENTRY);
  try {
    const result = await waitForOutcome(warmup);
    if (result.outcome !== "ready") {
      throw new Error(
        `warmup boot did not become ready (outcome=${result.outcome})\n${warmup.output}`,
      );
    }
  } finally {
    await killAndWait(warmup);
  }
  const db = new DatabaseSync(dbPathFor(home));
  try {
    db.exec("BEGIN");
    db.exec("DELETE FROM cards");
    const insertCard = db.prepare(`INSERT INTO cards (id, data) VALUES (?, ?)`);
    for (const card of cards) insertCard.run(card.id, JSON.stringify(card));
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
 * Every session-field value a fixture may carry, keyed by field name. Values are per-card so the
 * two fixtures cannot alias one another's ports or tokens, which would make a misattributed repair
 * look correct.
 */
function fieldValuesFor(home, spec, index) {
  return {
    tmuxSession: `dsp-${spec.identifier}`,
    ttydPort: 41991 + index,
    hookToken: `${spec.id}-hook-token-do-not-print-${1234567890 + index}`,
    claudeSessionId: `claude-session-${spec.id}-abcdef`,
    workspacePath: join(home, "workspaces", spec.identifier),
    workspace: {
      folder: spec.identifier,
      repos: [{ path: join(home, "repos", spec.identifier), base: "main" }],
    },
  };
}

/**
 * Build one card in the exact shape a migrated v3.0 board holds: the spec's flat fields present and
 * mirrored onto a single session record that `activeSessionId` names. The hazard is then produced
 * by the old build's own ordinary boot behaviour, needing no cooperation from the fixture beyond
 * being a realistic card in the column it claims.
 */
function makeMigratedFixture(home, spec, index) {
  const now = new Date().toISOString();
  const all = fieldValuesFor(home, spec, index);
  const fields = Object.fromEntries(spec.fields.map((f) => [f, all[f]]));
  const session = {
    id: randomUUID(),
    createdAt: now,
    updatedAt: now,
    ...fields,
  };
  return {
    id: spec.id,
    issueId: `${spec.id}-issue`,
    identifier: spec.identifier,
    title: `Migrated ${spec.role} card (${spec.column})`,
    description: null,
    priority: 3,
    column: spec.column,
    updatedAt: now,
    branch: `${spec.id}-branch`,
    ...fields,
    sessions: [session],
    activeSessionId: session.id,
  };
}

/** Resolve a card's active session record, or `undefined` if it owns none. */
function resolveActive(card) {
  if (!card?.activeSessionId || !Array.isArray(card.sessions)) return undefined;
  return card.sessions.find((s) => s.id === card.activeSessionId);
}

/**
 * Compare a card's flat projection with its active session record, field by field. Serialized
 * comparison, not reference comparison, because `workspace` is an object read back as two distinct
 * copies. `hookToken` is reported as a boolean only — never by value.
 */
function driftReport(card) {
  const active = resolveActive(card);
  return PROJECTION_FIELDS.map((field) => {
    const flat = card?.[field];
    const session = active?.[field];
    const drifted =
      JSON.stringify(flat ?? null) !== JSON.stringify(session ?? null);
    const render = (v) =>
      field === "hookToken"
        ? v === undefined || v === null
          ? "absent"
          : "present"
        : JSON.stringify(v);
    return { field, drifted, flat: render(flat), session: render(session) };
  });
}

function printDriftTable(label, rows) {
  console.log(`\n${label}`);
  console.log(
    `  ${"field".padEnd(17)}${"drifted".padEnd(9)}flat -> session record`,
  );
  for (const r of rows) {
    console.log(
      `  ${r.field.padEnd(17)}${String(r.drifted).padEnd(9)}${r.flat} -> ${r.session}`,
    );
  }
}

/**
 * Refuse to grade the repair unless the old build genuinely desynced the board first. This is the
 * gate that keeps leg 1 from passing for the wrong reason: an old build that failed to boot, or one
 * whose reconcile skipped the fixture, leaves a consistent board, and a repair check run against a
 * consistent board reports success having never executed. Both halves of the hazard are demanded —
 * the field-level drift AND the dropped `schemaVersion` key — because they are separate
 * consequences of the same downgrade and each one alone would understate it.
 */
function assertHazardOccurred(cards, meta) {
  for (const spec of FIXTURES) {
    const rows = driftReport(cards.get(spec.id));
    const drifted = rows.filter((r) => r.drifted).map((r) => r.field);
    const missing = spec.expectDrifted.filter((f) => !drifted.includes(f));
    const unexpected = drifted.filter((f) => !spec.expectDrifted.includes(f));
    console.log(
      `hazard: ${spec.id.padEnd(9)} (${spec.role}) drifted by ${OLD_RELEASE_TAG} = [${drifted.join(", ")}] (expected exactly [${spec.expectDrifted.join(", ")}])`,
    );
    if (missing.length > 0 || unexpected.length > 0) {
      throw new Error(
        `the ${OLD_RELEASE_TAG} boot did not produce the expected hazard on ${spec.id}, so this ` +
          `leg cannot grade the repair — it would report success having never run. ` +
          `missing=[${missing.join(", ")}] unexpected=[${unexpected.join(", ")}]`,
      );
    }
  }
  console.log(
    `hazard: meta.schemaVersion after ${OLD_RELEASE_TAG} = ${JSON.stringify(meta.schemaVersion)} (expected undefined — the old build's buildMeta has no such field, so its persist drops the key)`,
  );
  if (meta.schemaVersion !== undefined) {
    throw new Error(
      `expected ${OLD_RELEASE_TAG} to drop meta.schemaVersion, found ${JSON.stringify(meta.schemaVersion)} — ` +
        `the second half of the hazard did not occur, so the leg's premise is not established.`,
    );
  }
}

/**
 * Grade one card's post-repair state: nothing left drifted, every field the old build cleared now
 * cleared on the record too, and every field it did NOT touch preserved byte-identical to the seed.
 * The preserved half is the control that separates a repair from a clobber.
 */
function gradeRepairedCard(spec, seeded, after, violations) {
  const rows = driftReport(after);
  printDriftTable(
    `AFTER boot 2 — ${spec.id} (${spec.role}) flat vs active session record`,
    rows,
  );
  const stillDrifted = rows.filter((r) => r.drifted).map((r) => r.field);
  if (stillDrifted.length > 0) {
    violations.push(
      `${spec.id} (${spec.role}): the current build left [${stillDrifted.join(", ")}] drifted — an ` +
        `older build's write was not repaired, so a reader of the session record still sees ` +
        `session state the card does not have. ${spec.why}`,
    );
  }
  const active = resolveActive(after);
  for (const field of spec.fields) {
    const wasDrifted = spec.expectDrifted.includes(field);
    const seededValue = seeded.sessions[0][field];
    const ok = wasDrifted
      ? active?.[field] === undefined
      : JSON.stringify(active?.[field]) === JSON.stringify(seededValue);
    console.log(
      `  ${spec.id} session.${field.padEnd(17)}${wasDrifted ? "cleared" : "PRESERVED (control)"}=${ok}`,
    );
    if (!ok && wasDrifted) {
      violations.push(
        `${spec.id}: session record still holds ${field} after repair — the stale value survived`,
      );
    }
    if (!ok && !wasDrifted) {
      violations.push(
        `${spec.id} CONTROL: ${field} was not preserved through the repair — the repair overwrote a ` +
          `field the old build never touched, so it is not reconciling drift, it is clobbering`,
      );
    }
  }
  const idStable = active?.id === seeded.sessions[0].id;
  const count = after?.sessions?.length ?? 0;
  console.log(
    `  ${spec.id} session id stable=${idStable} count=${count} (expected true / 1 — a repair must never re-mint or add records)`,
  );
  if (!idStable || count !== 1) {
    violations.push(
      `${spec.id}: session identity moved during the repair: id stable=${idStable}, count=${count}`,
    );
  }
}

/**
 * Leg 1: boot the published old release against a migrated sandbox board, measure the drift it
 * causes, then boot the current build and grade the repair.
 */
async function legDrift() {
  await assertNoLiveService();
  assertBuilt();
  const oldEntry = buildOldRelease();
  const schemaVersion = readSessionSchemaVersion();
  const violations = [];
  const home = makeSandboxHome("drift");
  try {
    const seeded = FIXTURES.map((spec, i) =>
      makeMigratedFixture(home, spec, i),
    );
    await seedBoard(home, seeded, {
      syncedAt: null,
      workspaceFolders: [],
      lastUsed: null,
      schemaVersion,
    });
    console.log(
      `\nseeded: ${seeded.length} cards in the migrated steady state (meta.schemaVersion=${schemaVersion})`,
    );
    for (const spec of FIXTURES) {
      console.log(`  ${spec.id.padEnd(9)} ${spec.role.padEnd(15)} ${spec.why}`);
    }
    for (const [i, spec] of FIXTURES.entries()) {
      printDriftTable(
        `BEFORE (seed) — ${spec.id} flat vs active session record`,
        driftReport(seeded[i]),
      );
    }

    const old = await bootAndRead(OLD_RELEASE_TAG, home, oldEntry);
    console.log(
      `\nboot 1: ${OLD_RELEASE_TAG} (pid=${old.pid}) — the published build a not-yet-updated machine runs`,
    );
    for (const spec of FIXTURES) {
      printDriftTable(
        `AFTER boot 1 (${OLD_RELEASE_TAG}) — ${spec.id} flat vs active session record`,
        driftReport(old.cards.get(spec.id)),
      );
    }
    console.log("");
    assertHazardOccurred(old.cards, old.meta);

    const current = await bootAndRead("current build", home, DIST_ENTRY);
    console.log(`\nboot 2: current build (pid=${current.pid})`);
    for (const [i, spec] of FIXTURES.entries()) {
      gradeRepairedCard(
        spec,
        seeded[i],
        current.cards.get(spec.id),
        violations,
      );
    }

    const repairedIds = FIXTURES.filter((spec) =>
      current.output.includes(spec.id),
    ).map((spec) => spec.id);
    const loggedHeader = current.output.includes("downgrade repair:");
    const loggedFields = FIXTURES.every((spec) =>
      spec.expectDrifted.every((f) => current.output.includes(f)),
    );
    console.log(
      `\n  repair logged loudly: header=${loggedHeader} cardIds=[${repairedIds.join(", ")}] fieldNames=${loggedFields}`,
    );
    if (
      !loggedHeader ||
      !loggedFields ||
      repairedIds.length !== FIXTURES.length
    ) {
      violations.push(
        `the repair did not announce itself with every repaired card id and the field names — a ` +
          `silent repair is indistinguishable from no repair to anyone reading the log`,
      );
    }
    for (const card of seeded) {
      if (card.hookToken && current.output.includes(card.hookToken)) {
        violations.push(
          `SECURITY: the repair log printed ${card.id}'s hookToken by value`,
        );
      }
    }

    const updatedAtAfterRepair = FIXTURES.map((spec) =>
      resolveActive(current.cards.get(spec.id)),
    ).map((s) => s?.updatedAt);
    const third = await bootAndRead("current build (again)", home, DIST_ENTRY);
    const thirdDrift = FIXTURES.flatMap((spec) =>
      driftReport(third.cards.get(spec.id))
        .filter((r) => r.drifted)
        .map((r) => `${spec.id}.${r.field}`),
    );
    const repairedAgain = third.output.includes("downgrade repair:");
    const updatedAtStable = FIXTURES.every(
      (spec, i) =>
        resolveActive(third.cards.get(spec.id))?.updatedAt ===
        updatedAtAfterRepair[i],
    );
    console.log(
      `\nboot 3: current build (pid=${third.pid}) — idempotency: drifted=[${thirdDrift.join(", ")}] repairedAgain=${repairedAgain} session.updatedAt unchanged=${updatedAtStable}`,
    );
    if (thirdDrift.length > 0) {
      violations.push(
        `boot 3 still sees drift at [${thirdDrift.join(", ")}] — the disagreement survived two ` +
          `boots of the current build, so it is durable rather than transient`,
      );
    }
    if (repairedAgain || !updatedAtStable) {
      violations.push(
        `the repair is not idempotent: a boot against an already-consistent board repaired again ` +
          `(repairedAgain=${repairedAgain}) or re-stamped session.updatedAt (stable=${updatedAtStable})`,
      );
    }

    const versionRestored = third.meta.schemaVersion === schemaVersion;
    console.log(
      `  meta.schemaVersion restored to ${schemaVersion}: ${versionRestored} (found ${JSON.stringify(third.meta.schemaVersion)})`,
    );
    if (!versionRestored) {
      violations.push(
        `meta.schemaVersion is ${JSON.stringify(third.meta.schemaVersion)}, expected ${schemaVersion}`,
      );
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
  return violations;
}

/**
 * Leg 2: write a schema version this build does not understand and confirm it refuses to open the
 * board, exits non-zero, says something a user can act on, and leaves the database byte-identical.
 */
async function legNewer() {
  await assertNoLiveService();
  assertBuilt();
  const schemaVersion = readSessionSchemaVersion();
  const fromTheFuture = schemaVersion + 1;
  const violations = [];
  const home = makeSandboxHome("newer");
  try {
    await seedBoard(home, [], {
      syncedAt: null,
      workspaceFolders: [],
      lastUsed: null,
      schemaVersion: fromTheFuture,
    });
    console.log(
      `\nseeded: empty board at meta.schemaVersion=${fromTheFuture}, one ahead of this build's ${schemaVersion}`,
    );
    const before = statFile(dbPathFor(home));
    const child = spawnServer(home, DIST_ENTRY);
    let result;
    try {
      result = await waitForOutcome(child);
    } finally {
      await killAndWait(child);
    }
    const after = statFile(dbPathFor(home));

    console.log(
      `\nboot: current build (pid=${child.pid}) outcome=${result.outcome} exitCode=${result.code ?? "n/a"} signal=${result.signal ?? "n/a"}`,
    );
    if (result.outcome !== "exited") {
      violations.push(
        `the current build did NOT refuse a board from the future — it reached outcome=` +
          `${result.outcome}, meaning it opened a schema it cannot read and would have written to it`,
      );
    } else if (result.code === 0) {
      violations.push(
        `the current build exited 0 on a board from the future — a refusal must be a failure`,
      );
    }
    const saysNewer = child.output.includes(
      "was written by a NEWER version of dispatch",
    );
    const saysRemedy = child.output.includes(
      "npx @theyashgupta/dispatch@latest",
    );
    const saysUntouched = child.output.includes("Nothing was changed");
    console.log(
      `  message names the cause=${saysNewer} names the remedy=${saysRemedy} promises no damage=${saysUntouched}`,
    );
    if (!saysNewer || !saysRemedy || !saysUntouched) {
      violations.push(
        `the refusal did not tell the user what happened and what to do about it (cause=${saysNewer} ` +
          `remedy=${saysRemedy} untouched=${saysUntouched})`,
      );
    }
    const unchanged =
      before.exists === after.exists &&
      before.mtimeMs === after.mtimeMs &&
      before.size === after.size;
    console.log(
      `  sandbox board.db unchanged across the refusing boot: ${unchanged} (before ${JSON.stringify(before)}, after ${JSON.stringify(after)})`,
    );
    if (!unchanged) {
      violations.push(
        `the refusing boot modified the sandbox board.db — the message promises it did not`,
      );
    }
    console.log(`\n--- refusing boot output ---\n${child.output.trim()}\n---`);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
  return violations;
}

function statRealBoardDb() {
  const p = join(homedir(), DISPATCH_DIR_NAME, "board.db");
  return { path: p, ...statFile(p) };
}

function fmtStat(s) {
  return s.exists ? `mtimeMs=${s.mtimeMs} size=${s.size}` : "(absent)";
}

async function main() {
  const legArg = process.argv.includes("--leg")
    ? process.argv[process.argv.indexOf("--leg") + 1]
    : "all";
  if (!["all", "drift", "newer"].includes(legArg)) {
    throw new Error(
      `unknown --leg "${legArg}" (expected drift, newer, or all)`,
    );
  }

  const realBefore = statRealBoardDb();
  console.log(`LIVE ${realBefore.path} BEFORE: ${fmtStat(realBefore)}`);

  const violations = [];
  const ran = [];
  if (legArg === "all" || legArg === "drift") {
    console.log(
      `\n=== LEG 1: an older build must not be able to silently desync a migrated board ===`,
    );
    violations.push(...(await legDrift()));
    ran.push(`older-build drift repaired (vs ${OLD_RELEASE_TAG})`);
  }
  if (legArg === "all" || legArg === "newer") {
    console.log(
      `\n=== LEG 2: a board from a newer build must be refused, loudly and without damage ===`,
    );
    violations.push(...(await legNewer()));
    ran.push("newer-schema board refused");
  }

  const realAfter = statRealBoardDb();
  console.log(`\nLIVE ${realAfter.path} AFTER: ${fmtStat(realAfter)}`);
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

  if (violations.length === 0) {
    console.log(`\nPASS: ${ran.join("; ")}`);
    process.exit(0);
  }
  console.log(`\nFAIL: ${violations.length} violation(s)`);
  for (const v of violations) console.log(`  ${v}`);
  process.exit(1);
}

main().catch((err) => {
  console.error(`downgrade-guard-v3 failed: ${err.stack ?? err.message}`);
  process.exit(1);
});
