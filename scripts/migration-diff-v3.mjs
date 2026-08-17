/**
 * Session-entity migration verification harness (SESS-04, dev/ops tooling, NOT test code):
 * imports no test framework, asserts nothing via an assertion library, lives outside src/ — the
 * same category as check-invariants.mjs, check-doc-drift.mjs, and perf-board.mjs. It answers the
 * question ROADMAP success criteria 1 and 2 need answered: does the boot migration project every
 * v2.9-shaped card into exactly the right session shape, across two genuinely separate boots, with
 * a retained pre-migration snapshot — not "does the board look right".
 *
 * SANDBOX SAFETY IS SCOPED TO STATE ON DISK, NOT TO PROCESS STATE. What assertSandboxSafe enforces
 * before any fs/spawn call is the database and the port; it does NOT and cannot fence the
 * machine-wide ttyd sweep documented under KNOWN, ACCEPTED SIDE EFFECT below, and the
 * before/after mtime+size assertion at the end verifies only board.db — it will report a clean
 * PASS on a run that reaped every live ttyd. Read that section before running this against a
 * machine with live sessions. Within that scope the guarantee is absolute: this
 * harness seeds a throwaway board.db and boots the BUILT server twice against it. It never opens,
 * migrates, or mutates the real `~/.dispatch/board.db` — every sandbox HOME lives under
 * `os.tmpdir()` with a `dispatch-migration-diff-v3-` basename, verified structurally, and the
 * sandbox port is asserted to never be 4700 (the user's live dispatch instance). The real
 * board.db's mtime and size are recorded before this script does anything and again after it
 * finishes; a mismatch is a loud non-zero-exit failure, not a warning.
 *
 * The frontend dev-server proxy config is never used: it hardcodes its dev-mode `/api/`/`/sessions/`
 * targets to the user's real, live dispatch port, exactly as perf-board.mjs's own header documents.
 * This harness only ever boots the production build (`dist/server/bootstrap/index.js`), and
 * COMPILES it first ({@link assertBuilt}) so the verdict is always a property of the current
 * `src/` — a `dist` left over from an earlier commit otherwise reports today's fixes as absent,
 * blaming source that already reads correctly.
 *
 * KNOWN, ACCEPTED SIDE EFFECT (T-90-19): booting the sandbox server runs `reconcileSessions()`,
 * which sweeps `dsp-` ttyd processes MACHINE-WIDE via `adoptAndSweep` — not scoped by HOME. Running
 * this harness therefore reaps any of the user's own orphaned ttyd processes exactly as a normal
 * restart would (tmux sessions themselves are untouched; ttyd respawns on the next terminal open).
 * The fixture cards below are deliberately seeded on the `done` column specifically so that
 * `reconcileSessions()`'s session-lost/ttyd-adoption logic — real, unrelated-to-migration app
 * behavior that would otherwise clear `tmuxSession`/`ttydPort`/`hookToken` for a card whose tmux
 * session isn't actually live — never touches them (`reconcile.ts` `continue`s immediately for a
 * not-live `todo`/`done` card, before either the session-lost or the ttyd-candidate branch runs),
 * so any MISMATCH this script reports is attributable to the migration, not to reconcile.
 *
 * Usage:
 *   node scripts/migration-diff-v3.mjs      run the full two-boot migration verdict
 *
 * Exit codes: 0 all checks PASS. 1 setup/build/sandbox-safety error, a MISMATCH in the migration
 * verdict, a failed structural/retained-snapshot/cross-boot check, or the live board.db changing.
 */
import { spawn, execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir, homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST_ENTRY = join(REPO_ROOT, "dist", "server", "bootstrap", "index.js");

/**
 * The package script {@link assertBuilt} shells out to. Named here rather than spelled as a raw
 * `tsc -p …` invocation so the harness can never compile the server differently from the way the
 * project does — one build command, not two literals that can drift apart.
 */
const BUILD_SERVER_SCRIPT = "build:server";

const SANDBOX_PORT = 47831;
const SANDBOX_PREFIX = "dispatch-migration-diff-v3-";

const POLL_INTERVAL_MS = 100;
const READY_TIMEOUT_MS = 30_000;
const KILL_TIMEOUT_MS = 5_000;

/** The six CONTEXT-locked session fields plus `branch`, the deliberate CONTROL column. */
const SESSION_COLUMNS = [
  "tmuxSession",
  "ttydPort",
  "hookToken",
  "claudeSessionId",
  "workspacePath",
  "workspace",
];
const COMPARED_COLUMNS = [...SESSION_COLUMNS, "branch"];

/** Expected post-migration session count per fixture card id. */
const EXPECTED_SESSION_COUNT = {
  "mig-full": 1,
  "mig-partial": 1,
  "mig-none": 0,
  "mig-group": 1,
  "mig-member": 0,
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * The structural guarantee behind "never touches the user's real board.db or port 4700": called
 * before any filesystem write or child-process spawn touching `home`. Throws (never silently
 * degrades) if any check fails.
 * @remarks Its scope is exactly the four checks below — port, real-HOME identity, tmpdir
 * containment, basename prefix. PROCESS state is deliberately outside that scope: nothing here
 * prevents the sandbox server's boot-time `reconcileSessions()` from sweeping `dsp-` ttyd
 * processes machine-wide, because that sweep is not scoped by HOME. The name promises a sandbox
 * for the DATABASE; do not read it as a sandbox for the machine.
 */
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

/**
 * Sandbox HOME whose config carries only a hardcoded, obviously-fake placeholder Linear key —
 * never the real `~/.dispatch/config.json`'s key. This harness seeds cards directly via
 * node:sqlite, so it never reads or needs a real key.
 */
const FAKE_LINEAR_API_KEY = "migration-diff-v3-harness-fake-key-never-real";

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
 * Memoized result of the one server compile per process — see {@link assertBuilt}. `null` until the
 * first call; every later call reuses it, so this harness's two boots cost exactly one `tsc` run
 * between them.
 */
let serverBuild = null;

/**
 * Compile the server this harness is about to boot, then confirm the entry point exists.
 *
 * This REPLACES an existence-only precondition that was actively misleading: the harness boots
 * `dist`, never `src` (see {@link bootServer}), so a `dist` predating a source fix reported that
 * fix as absent — a correct source tree failing its own migration verdict, with the MISMATCH text
 * blaming migration code that already read correctly. Detecting that by mtime is not sound here:
 * `tsc` leaves an output file untouched when its emitted text is unchanged, so `dist` legitimately
 * holds artifacts older than the last build, and a comment-only source edit (this codebase is
 * JSDoc-dense) would trip an mtime guard that no rebuild could clear. Compiling unconditionally
 * makes the staleness class structurally impossible rather than merely detectable.
 *
 * `build:server` is the right half here and `build` would be wrong: this harness boots the server
 * and reads sqlite, never a rendered page, so the web bundle is not part of what it measures.
 *
 * `stdio: "pipe"` keeps a clean transcript on success while folding `tsc`'s own diagnostics into
 * the thrown error on failure — a source tree that does not compile must stop the run outright,
 * never fall through to boot the previous build and report its behaviour as today's.
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
    `preflight: compiled src/ -> dist/ via \`npm run ${BUILD_SERVER_SCRIPT}\` in ${serverBuild.durationMs}ms — both boots below run current source`,
  );
  return serverBuild;
}

/**
 * Boot the harness's own server against `home`. Only ever spawns the production build — this
 * harness never supports `--dev` (see the file header: the Vite dev proxy is hardcoded to the
 * user's real, live dispatch port).
 * @remarks The build precondition is asserted here through {@link assertBuilt} rather than by a
 * local `existsSync` copy, so the staleness half can never be enforced at only some of the places
 * that spawn `dist` — this is the function every boot in the file funnels through.
 */
function bootServer(home) {
  assertBuilt();
  return spawn("node", [DIST_ENTRY], {
    env: { ...process.env, HOME: home, NODE_ENV: "production" },
    stdio: ["ignore", "ignore", "ignore"],
  });
}

/**
 * Boot a NEW child process against `home`, wait for it to become ready, capture its pid and a
 * wall-clock start/end timestamp pair, then kill it and read the sandbox board.db's cards and
 * meta row back via a fresh, direct node:sqlite connection. Boot + kill + reopen (never reading
 * through a still-live server connection) mirrors perf-board.mjs's own seedDoneCards idiom.
 */
async function bootAndRead(home) {
  const startedAt = new Date().toISOString();
  const child = bootServer(home);
  const pid = child.pid;
  await waitForReady(SANDBOX_PORT);
  const endedAt = new Date().toISOString();
  await killAndWait(child);
  const dbPath = join(home, ".dispatch", "board.db");
  return {
    pid,
    startedAt,
    endedAt,
    dbPath,
    cards: readCards(dbPath),
    meta: readMeta(dbPath),
  };
}

/** Read every card row as a `Map<id, card>` via a read-only direct connection. */
function readCards(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const rows = db.prepare("SELECT data FROM cards").all();
    const map = new Map();
    for (const row of rows) {
      const card = JSON.parse(row.data);
      map.set(card.id, card);
    }
    return map;
  } finally {
    db.close();
  }
}

/** Read the single meta row (id=0) as a parsed object, or `{}` when absent. */
function readMeta(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const row = db.prepare("SELECT data FROM meta WHERE id = 0").get();
    return row ? JSON.parse(row.data) : {};
  } finally {
    db.close();
  }
}

/**
 * The five v2.9-shaped fixture cards, seeded as OLD-shaped rows (no `sessions`/`activeSessionId`
 * keys at all). `mig-full` and `mig-group` deliberately sit on the `done` column (see the file
 * header's KNOWN, ACCEPTED SIDE EFFECT note) so `reconcileSessions()`'s dead-tmux-session handling
 * never touches their session fields — a `done`/`todo` card whose claimed tmux session isn't live
 * is left completely alone by `reconcile.ts`, unlike an `in_progress` card, which would be marked
 * session-lost and have `tmuxSession`/`ttydPort`/`hookToken` cleared for reasons that have nothing
 * to do with this migration.
 */
function makeFixtureCards(home) {
  const now = new Date().toISOString();
  const workspaceFor = (n) => ({
    folder: `MIG-${n}`,
    repos: [{ path: join(home, "repos", `MIG-${n}`), base: "main" }],
  });
  return [
    {
      id: "mig-full",
      issueId: "mig-full-issue",
      identifier: "MIG-1",
      title: "All six session fields present",
      description: null,
      priority: 3,
      column: "done",
      updatedAt: now,
      branch: "mig-full-branch",
      tmuxSession: "dsp-MIG-1",
      ttydPort: 41001,
      hookToken: "mig-full-hook-token-do-not-print-1234567890",
      claudeSessionId: "claude-session-mig-full-abcdef",
      workspacePath: join(home, "workspaces", "MIG-1"),
      workspace: workspaceFor(1),
    },
    {
      id: "mig-partial",
      issueId: "mig-partial-issue",
      identifier: "MIG-2",
      title: "Only workspacePath present — CONTEXT's partial-fields edge case",
      description: null,
      priority: 3,
      column: "in_progress",
      updatedAt: now,
      branch: "mig-partial-branch",
      workspacePath: join(home, "workspaces", "MIG-2"),
    },
    {
      id: "mig-none",
      issueId: "mig-none-issue",
      identifier: "MIG-3",
      title: "Zero session fields",
      description: null,
      priority: 3,
      column: "todo",
      updatedAt: now,
      branch: "mig-none-branch",
    },
    {
      id: "mig-group",
      issueId: "mig-group-issue",
      identifier: "MIG-4",
      title: "Group card, all six session fields present",
      description: null,
      priority: 3,
      column: "done",
      updatedAt: now,
      branch: "mig-group-branch",
      memberIds: ["mig-member"],
      tmuxSession: "dsp-MIG-4",
      ttydPort: 41004,
      hookToken: "mig-group-hook-token-do-not-print-0987654321",
      claudeSessionId: "claude-session-mig-group-abcdef",
      workspacePath: join(home, "workspaces", "MIG-4"),
      workspace: workspaceFor(4),
    },
    {
      id: "mig-member",
      issueId: "mig-member-issue",
      identifier: "MIG-5",
      title: "Member card — must own zero sessions",
      description: null,
      priority: 3,
      column: "done",
      updatedAt: now,
      branch: "mig-member-branch",
      groupId: "mig-group",
    },
  ];
}

/**
 * Boot once against the empty sandbox home purely to get a real schema, kill it, then insert the
 * fixture rows directly via node:sqlite (perf-board.mjs's seedDoneCards idiom). Then defuse the
 * warmup-boot trap the plan flags: the warmup boot's own `load()` unconditionally advances the
 * meta row's `schemaVersion` even on an empty database, which would make the REAL boot below
 * think migration already ran. Reset `schemaVersion` to 0 and delete any `.pre-v3`/`.bak.*` files
 * so the real boot's migration pass is guaranteed to run for real.
 */
async function seedFixtureCards(home, fixtures) {
  const warmup = bootServer(home);
  try {
    await waitForReady(SANDBOX_PORT);
  } finally {
    await killAndWait(warmup);
  }

  const dbPath = join(home, ".dispatch", "board.db");
  const db = new DatabaseSync(dbPath);
  try {
    const insertCard = db.prepare(
      `INSERT INTO cards (id, data) VALUES (?, ?)
       ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
    );
    const writeMeta = db.prepare(
      `INSERT INTO meta (id, data) VALUES (0, @data)
       ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
    );
    db.exec("BEGIN");
    for (const card of fixtures) {
      insertCard.run(card.id, JSON.stringify(card));
    }
    const metaRow = db.prepare("SELECT data FROM meta WHERE id = 0").get();
    const meta = metaRow ? JSON.parse(metaRow.data) : {};
    delete meta.schemaVersion;
    writeMeta.run({ data: JSON.stringify(meta) });
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  } finally {
    db.close();
  }

  const dispatchDir = join(home, ".dispatch");
  for (const entry of readdirSync(dispatchDir)) {
    if (entry.endsWith(".pre-v3") || /\.bak\.(\d+|tmp)$/.test(entry)) {
      rmSync(join(dispatchDir, entry), { force: true });
    }
  }
  if (existsSync(join(dispatchDir, "board.db.pre-v3"))) {
    throw new Error(
      "ABORT: board.db.pre-v3 still exists after the seed step's reset — the retained-snapshot " +
        "criterion would be unprovable if the real boot below skipped migration. Refusing to " +
        "produce a verdict.",
    );
  }
}

/** Structural deep-equal over JSON-safe values (objects/arrays/primitives, `undefined`-aware). */
function deepEqual(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  if (typeof a !== "object" || typeof b !== "object") return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((k) => deepEqual(a[k], b[k]));
}

/** Resolve a card's active session record, or `undefined` if it owns none. */
function resolveActive(card) {
  if (!card.activeSessionId || !Array.isArray(card.sessions)) return undefined;
  return card.sessions.find((s) => s.id === card.activeSessionId);
}

/**
 * PASS iff the card's flat field equals BEFORE, and (for the six session columns) the active
 * session's own field also equals BEFORE — or, for `branch`, the active session carries no
 * `branch` key at all (the CONTROL column: it must never move onto the session record).
 */
function columnPass(col, before, after, active) {
  if (col === "branch") {
    const flatOk = deepEqual(after.branch, before.branch);
    const sessionOk = !active || !("branch" in active);
    return flatOk && sessionOk;
  }
  const flatOk = deepEqual(after[col], before[col]);
  if (active) return flatOk && deepEqual(active[col], before[col]);
  return flatOk && before[col] === undefined;
}

/**
 * A safe-to-print description of a mismatch — `hookToken` is NEVER printed by value, and its
 * flat and session copies are reported as SEPARATE equal/not-equal booleans (a dropped-field bug
 * like BREAK A only fails the session copy while the flat mirror, which the migration never
 * touches, stays correct — collapsing the two into one boolean would misreport which side failed).
 */
function describeMismatch(cardId, col, before, after, active) {
  if (col === "hookToken") {
    const b = before.hookToken;
    const flatEqual = b === after.hookToken;
    const sessionEqual = b === active?.hookToken;
    return (
      `${cardId}.${col}: <redacted> flatEqual=${flatEqual} sessionEqual=${sessionEqual} ` +
      `(before ${b === undefined ? "absent" : "present"}, ` +
      `flat ${after.hookToken === undefined ? "absent" : "present"}, ` +
      `session ${active?.hookToken === undefined ? "absent" : "present"})`
    );
  }
  return (
    `${cardId}.${col}: expected ${JSON.stringify(before[col])}, ` +
    `flat=${JSON.stringify(after[col])} session=${JSON.stringify(active?.[col])}`
  );
}

/**
 * Build the per-card, seven-column verdict for one boot's AFTER state against the shared BEFORE
 * fixtures. Returns `{ rows, violations }` — `rows` for the printed table, `violations` for the
 * shared exit-code accumulator.
 */
function buildColumnVerdict(fixtures, afterCards) {
  const rows = [];
  const violations = [];
  for (const before of fixtures) {
    const after = afterCards.get(before.id);
    if (!after) {
      violations.push(`${before.id}: card missing after migration boot`);
      rows.push({
        id: before.id,
        identifier: before.identifier,
        cells: COMPARED_COLUMNS.map(() => "MISMATCH"),
      });
      continue;
    }
    const active = resolveActive(after);
    const cells = [];
    for (const col of COMPARED_COLUMNS) {
      const pass = columnPass(col, before, after, active);
      cells.push(pass ? "PASS" : "MISMATCH");
      if (!pass)
        violations.push(
          describeMismatch(before.id, col, before, after, active),
        );
    }
    rows.push({ id: before.id, identifier: before.identifier, cells });
  }
  return { rows, violations };
}

/** Print the per-card verdict table. */
function printVerdictTable(label, rows) {
  console.log(`\n${label}`);
  console.log(`cardId       identifier  ${COMPARED_COLUMNS.join("  ")}`);
  for (const row of rows) {
    console.log(
      `${row.id.padEnd(13)}${row.identifier.padEnd(12)}${row.cells
        .map((c, i) => c.padEnd(COMPARED_COLUMNS[i].length + 2))
        .join("")}`,
    );
  }
}

/**
 * Structural facts CONTEXT names as their own criteria, not folded into the per-column table:
 * session count matches {@link EXPECTED_SESSION_COUNT}, and the activeSessionId/sessions pointer
 * invariant holds in both directions (a count of 1 names a real session; a count of 0 carries
 * neither `sessions` nor `activeSessionId` at all).
 */
function checkStructural(fixtures, afterCards) {
  const violations = [];
  for (const before of fixtures) {
    const after = afterCards.get(before.id);
    if (!after) continue;
    const expected = EXPECTED_SESSION_COUNT[before.id];
    const sessions = Array.isArray(after.sessions) ? after.sessions : [];
    const actual = sessions.length;
    const status = actual === expected ? "PASS" : "MISMATCH";
    console.log(
      `  session count  ${before.id.padEnd(13)} expected=${expected} actual=${actual} ${status}`,
    );
    if (actual !== expected) {
      violations.push(
        `${before.id}: expected ${expected} session(s), found ${actual}`,
      );
    }
    if (expected === 1) {
      const pointerOk =
        typeof after.activeSessionId === "string" &&
        sessions.some((s) => s.id === after.activeSessionId);
      console.log(
        `  active pointer ${before.id.padEnd(13)} ${pointerOk ? "PASS" : "MISMATCH"}`,
      );
      if (!pointerOk) {
        violations.push(
          `${before.id}: activeSessionId "${after.activeSessionId}" does not name a session present in sessions[]`,
        );
      }
    } else {
      const pointerOk =
        after.activeSessionId === undefined && after.sessions === undefined;
      console.log(
        `  no pointer     ${before.id.padEnd(13)} ${pointerOk ? "PASS" : "MISMATCH"}`,
      );
      if (!pointerOk) {
        violations.push(
          `${before.id}: expected no sessions/activeSessionId, found sessions=${JSON.stringify(after.sessions)} activeSessionId=${JSON.stringify(after.activeSessionId)}`,
        );
      }
    }
  }
  return violations;
}

/** The retained-snapshot criterion: `board.db.pre-v3` exists, and at least one `.bak.N` slot exists. */
function checkRetainedSnapshot(home) {
  const violations = [];
  const dispatchDir = join(home, ".dispatch");
  const preV3 = join(dispatchDir, "board.db.pre-v3");
  const preV3Exists = existsSync(preV3);
  console.log(`\nretained snapshot: board.db.pre-v3 exists=${preV3Exists}`);
  if (!preV3Exists)
    violations.push("board.db.pre-v3 does not exist after boot 1");
  const bakExists = [1, 2, 3, 4, 5].some((n) =>
    existsSync(join(dispatchDir, `board.db.bak.${n}`)),
  );
  console.log(
    `retained snapshot: at least one .bak.N slot exists=${bakExists}`,
  );
  if (!bakExists)
    violations.push(
      "no board.db.bak.N slot exists after boot 1's forced backupTick",
    );
  return violations;
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
 * Boot 2 must not overwrite the retained pre-migration snapshot: `board.db.pre-v3`'s mtime and
 * size after boot 2 must equal what they were after boot 1 (this is only true because boot 2's
 * persisted `schemaVersion` already equals {@link SESSION_SCHEMA_VERSION}'s target, so its own
 * `load()` never calls `snapshotPreV3()` again — `snapshotPreV3()`'s own `existsSync` guard would
 * also refuse a second write, but a boot that skips the call entirely is the stronger proof).
 */
function checkRetainedSnapshotStable(preV3AfterBoot1, preV3AfterBoot2) {
  const violations = [];
  const stable =
    preV3AfterBoot1.exists &&
    preV3AfterBoot2.exists &&
    preV3AfterBoot1.mtimeMs === preV3AfterBoot2.mtimeMs &&
    preV3AfterBoot1.size === preV3AfterBoot2.size;
  console.log(
    `retained snapshot: board.db.pre-v3 unchanged across boot 2 = ${stable} ` +
      `(after boot 1: ${JSON.stringify(preV3AfterBoot1)}, after boot 2: ${JSON.stringify(preV3AfterBoot2)})`,
  );
  if (!stable) {
    violations.push(
      `board.db.pre-v3 changed between boot 1 and boot 2 (after boot 1: ${JSON.stringify(preV3AfterBoot1)}, ` +
        `after boot 2: ${JSON.stringify(preV3AfterBoot2)}) — boot 2 must not overwrite the retained snapshot`,
    );
  }
  return violations;
}

/**
 * PASS iff `cardA`/`cardB` (the SAME fixture read back after two independent boots) agree on the
 * flat field, the active session's field, and — for `branch` — that neither active session ever
 * carries a `branch` key. Mirrors {@link columnPass} but compares two AFTER states to each other
 * instead of BEFORE to AFTER, which is what makes idempotency (not just correctness) checkable.
 */
function afterColumnEqual(col, cardA, activeA, cardB, activeB) {
  if (col === "branch") {
    return (
      deepEqual(cardA.branch, cardB.branch) &&
      (!activeA || !("branch" in activeA)) &&
      (!activeB || !("branch" in activeB))
    );
  }
  return (
    deepEqual(cardA[col], cardB[col]) &&
    deepEqual(activeA?.[col], activeB?.[col])
  );
}

/**
 * The idempotency proof ROADMAP success criterion 2 requires: for every fixture card, boot 1 and
 * boot 2 must agree on session COUNT, the session id SET (compared as sets, per card — this is
 * what makes re-minting on the second pass detectable), `activeSessionId`, and all seven compared
 * columns. A session-id-set mismatch is the single strongest signal a migration re-ran and re-
 * minted ids on an already-migrated card.
 */
function checkCrossBoot(fixtures, boot1Cards, boot2Cards) {
  const violations = [];
  for (const before of fixtures) {
    const c1 = boot1Cards.get(before.id);
    const c2 = boot2Cards.get(before.id);
    if (!c1 || !c2) {
      violations.push(`${before.id}: missing from boot 1 or boot 2 read`);
      continue;
    }
    const ids1 = new Set((c1.sessions ?? []).map((s) => s.id));
    const ids2 = new Set((c2.sessions ?? []).map((s) => s.id));
    const countOk = ids1.size === ids2.size;
    const idSetOk = countOk && [...ids1].every((id) => ids2.has(id));
    const pointerOk = c1.activeSessionId === c2.activeSessionId;
    const active1 = resolveActive(c1);
    const active2 = resolveActive(c2);
    let columnsOk = true;
    for (const col of COMPARED_COLUMNS) {
      if (!afterColumnEqual(col, c1, active1, c2, active2)) {
        columnsOk = false;
        const detail =
          col === "hookToken"
            ? "<redacted>"
            : `boot1=${JSON.stringify(c1[col])} boot2=${JSON.stringify(c2[col])}`;
        violations.push(
          `${before.id}.${col}: differs between boot 1 and boot 2 (${detail})`,
        );
      }
    }
    const rowOk = countOk && idSetOk && pointerOk && columnsOk;
    console.log(
      `  cross-boot     ${before.id.padEnd(13)} count(${ids1.size}==${ids2.size}) idSet=${idSetOk} activeSessionId=${pointerOk} columns=${columnsOk} ${rowOk ? "PASS" : "MISMATCH"}`,
    );
    if (!countOk) {
      violations.push(
        `${before.id}: session count differs between boot 1 (${ids1.size}) and boot 2 (${ids2.size})`,
      );
    } else if (!idSetOk) {
      violations.push(
        `${before.id}: session id set differs between boot 1 (${[...ids1]}) and boot 2 (${[...ids2]})`,
      );
    }
    if (!pointerOk) {
      violations.push(
        `${before.id}: activeSessionId differs between boot 1 (${c1.activeSessionId}) and boot 2 (${c2.activeSessionId})`,
      );
    }
  }
  return violations;
}

function statRealBoardDb() {
  const p = join(homedir(), ".dispatch", "board.db");
  try {
    const st = statSync(p);
    return { path: p, exists: true, mtimeMs: st.mtimeMs, size: st.size };
  } catch {
    return { path: p, exists: false, mtimeMs: null, size: null };
  }
}

function fmtStat(s) {
  return s.exists ? `mtimeMs=${s.mtimeMs} size=${s.size}` : "(absent)";
}

async function main() {
  const realBefore = statRealBoardDb();
  console.log(`LIVE ${realBefore.path} BEFORE: ${fmtStat(realBefore)}`);

  const violations = [];
  const home = makeSandboxHome("run1");
  try {
    const fixtures = makeFixtureCards(home);
    await seedFixtureCards(home, fixtures);

    const boot1 = await bootAndRead(home);
    console.log(
      `\nboot 1: pid=${boot1.pid} start=${boot1.startedAt} end=${boot1.endedAt}`,
    );
    console.log(`boot 1: meta.schemaVersion=${boot1.meta.schemaVersion}`);

    const { rows, violations: columnViolations } = buildColumnVerdict(
      fixtures,
      boot1.cards,
    );
    printVerdictTable("Per-card seven-column verdict (boot 1)", rows);
    violations.push(...columnViolations);
    violations.push(...checkStructural(fixtures, boot1.cards));
    violations.push(...checkRetainedSnapshot(home));

    const preV3Path = join(home, ".dispatch", "board.db.pre-v3");
    const preV3AfterBoot1 = statFile(preV3Path);

    const boot2 = await bootAndRead(home);
    console.log(
      `\nboot 2: pid=${boot2.pid} start=${boot2.startedAt} end=${boot2.endedAt}`,
    );
    console.log(`boot 2: meta.schemaVersion=${boot2.meta.schemaVersion}`);
    console.log(
      `boot PIDs distinct: boot1=${boot1.pid} boot2=${boot2.pid} distinct=${boot1.pid !== boot2.pid}`,
    );
    if (boot1.pid === boot2.pid) {
      violations.push(
        `boot 1 and boot 2 share the same pid (${boot1.pid}) — they were not genuinely separate processes`,
      );
    }

    const preV3AfterBoot2 = statFile(preV3Path);
    violations.push(
      ...checkRetainedSnapshotStable(preV3AfterBoot1, preV3AfterBoot2),
    );

    violations.push(...checkCrossBoot(fixtures, boot1.cards, boot2.cards));
  } finally {
    rmSync(home, { recursive: true, force: true });
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
    console.log(`\nPASS: 5/5 cards migrated correctly`);
    process.exit(0);
  }
  console.log(`\nFAIL: ${violations.length} mismatch(es)`);
  for (const v of violations) console.log(`  ${v}`);
  process.exit(1);
}

main().catch((err) => {
  console.error(`migration-diff-v3 failed: ${err.stack ?? err.message}`);
  process.exit(1);
});
