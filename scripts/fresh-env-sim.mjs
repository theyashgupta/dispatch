/**
 * Fresh-environment Docker simulator (dev/ops tooling, NOT test code): imports no test framework,
 * defines no test cases, and lives outside src/ — the same category as scripts/check-invariants.mjs
 * and eslint.config.ts. It is invoked by a human or an agent through one command, `npm run sim`.
 *
 * It answers one question that no amount of reading the source can: on a genuinely fresh Linux box,
 * does dispatch actually behave? It packs THIS working tree, installs that tarball into disposable
 * Debian containers whose tool inventory is a build arg, runs real scenarios against them, and
 * reports a PASS/FAIL matrix.
 *
 * Modes:
 *   npm run sim                    build the images, run every scenario, print the matrix
 *   npm run sim -- --build-only    build the images and stop
 *   npm run sim -- --only <sub>    run only scenarios whose id contains <sub>
 *   npm run sim -- --clean         remove the images this harness tagged, then exit
 *
 * Two rules hold everywhere in this file. Every docker invocation is a spawnSync argv ARRAY, never a
 * shell string — nothing here is ever interpreted by a shell (T-41-01). And `--clean` may only ever
 * remove images inside this harness's own tag namespace (T-41-02): `docker system prune`,
 * `docker image prune`, and dangling sweeps are forbidden, because they would destroy unrelated
 * local Docker state that this harness did not create.
 */
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SIM_DIR = join(REPO_ROOT, "scripts", "sim");
const DOCKERFILE = join(SIM_DIR, "Dockerfile");

/** The tag namespace this harness owns. `--clean` and the scenario table both read it, so the two can never drift apart. */
const TAG_NAMESPACE = "dispatch-sim";

/** The entry `npm pack` MUST have included; its absence means a stale or absent dist/. */
const REQUIRED_TARBALL_ENTRY = "dist/server/bootstrap/cli.js";

/** The image matrix: tool inventory and package-manager presence are build args, so one Dockerfile spans every box. */
const IMAGES = [
  {
    tag: `${TAG_NAMESPACE}:node22-onlynode`,
    node: "22",
    tools: "none",
    pkgManager: "none",
  },
  {
    tag: `${TAG_NAMESPACE}:node22-bare`,
    node: "22",
    tools: "none",
    pkgManager: "apt",
  },
  {
    tag: `${TAG_NAMESPACE}:node22-tmuxgit`,
    node: "22",
    tools: "tmuxgit",
    pkgManager: "apt",
  },
  {
    tag: `${TAG_NAMESPACE}:node24-tmuxgit`,
    node: "24",
    tools: "tmuxgit",
    pkgManager: "apt",
  },
];

/** How long one container gets before it is killed and its row recorded as a timeout. */
const RUN_TIMEOUT_MS = 180_000;

/** Container-name prefix this harness owns; forced removal is scoped to it, never to a bare `docker rm`. */
const CONTAINER_PREFIX = "dsp-sim-";

/** The exact guidance strings preflight.ts renders when no package manager is on PATH. */
const GENERIC_HINTS = {
  tmux: "install tmux via your platform's package manager or build from source",
  ttyd: "install ttyd — https://github.com/tsl0922/ttyd/releases",
  git: "install git — https://git-scm.com/downloads",
};

/** The print-only guidance for `claude`, which is never package-manager-installed. */
const CLAUDE_HINT = "install Claude Code — https://docs.claude.com/claude-code";

/**
 * The crash class the node:sqlite swap removed, plus the warning it must keep filtered.
 * @remarks A boot row that only checked "the server started" would be the false green this milestone
 * exists to prevent: a native-module mismatch is exactly the failure that reaches a user's fresh box
 * and never this machine, so the EXCLUSIONS — not the listening line — are the actual SIM-03 claim.
 */
const NATIVE_CRASH_MARKERS = [
  "ExperimentalWarning",
  "MODULE_NOT_FOUND",
  "ERR_DLOPEN_FAILED",
  "was compiled against a different Node.js version",
];

/**
 * The scenario matrix.
 * @remarks Each `argv` is a STATIC constant (T-41-01): no host value, env var, cwd, or CLI argument
 * is ever interpolated into a container command, and no row is ever a shell string. `-t` is
 * deliberately never passed — no TTY is exactly what puts `doctor` on its non-interactive
 * print-only branch (INST-03), which is the branch these rows exist to assert.
 */
const SCENARIOS = [
  {
    id: "install-only-node",
    requirement: "SIM-02",
    node: "22",
    image: `${TAG_NAMESPACE}:node22-onlynode`,
    argv: ["dispatch", "doctor"],
    assert: (r) =>
      check(r, {
        expectCode: 0,
        present: [
          "✗ tmux",
          "✗ ttyd",
          "✗ git",
          "✗ claude",
          GENERIC_HINTS.tmux,
          GENERIC_HINTS.ttyd,
          GENERIC_HINTS.git,
          CLAUDE_HINT,
        ],
        absent: ["apt-get", "brew"],
      }),
  },
  {
    id: "install-all-binaries-missing",
    requirement: "SIM-02",
    node: "22",
    image: `${TAG_NAMESPACE}:node22-bare`,
    argv: ["dispatch", "doctor"],
    assert: (r) =>
      check(r, {
        expectCode: 0,
        present: [
          "apt-get install tmux",
          "apt-get install ttyd",
          "apt-get install git",
          CLAUDE_HINT,
        ],
        absent: ["apt-get install claude", "brew", "[Y/n]"],
      }),
  },
  {
    id: "install-ttyd-missing",
    requirement: "SIM-02",
    node: "22",
    image: `${TAG_NAMESPACE}:node22-tmuxgit`,
    argv: ["dispatch", "doctor"],
    assert: (r) =>
      check(r, {
        expectCode: 0,
        present: ["✓ tmux", "✓ git", "apt-get install ttyd"],
        absent: ["apt-get install tmux", "apt-get install git"],
      }),
  },
  {
    id: "boot-setup-screen-node22",
    requirement: "SIM-03",
    node: "22",
    image: `${TAG_NAMESPACE}:node22-tmuxgit`,
    argv: ["/opt/sim/boot-probe.sh"],
    assert: bootSetupAssert("22"),
  },
  {
    id: "boot-setup-screen-node24",
    requirement: "SIM-03",
    node: "24",
    image: `${TAG_NAMESPACE}:node24-tmuxgit`,
    argv: ["/opt/sim/boot-probe.sh"],
    assert: bootSetupAssert("24"),
  },
  {
    id: "classifier-corrupt-recovers-node22",
    requirement: "SIM-04",
    node: "22",
    image: `${TAG_NAMESPACE}:node22-tmuxgit`,
    argv: ["/opt/sim/classifier-corrupt.sh"],
    assert: corruptRecoversAssert,
  },
  {
    id: "classifier-corrupt-recovers-node24",
    requirement: "SIM-04",
    node: "24",
    image: `${TAG_NAMESPACE}:node24-tmuxgit`,
    argv: ["/opt/sim/classifier-corrupt.sh"],
    assert: corruptRecoversAssert,
  },
  {
    id: "classifier-denied-untouched-node22",
    requirement: "SIM-04",
    node: "22",
    image: `${TAG_NAMESPACE}:node22-tmuxgit`,
    user: "node",
    home: "/home/node",
    argv: ["/opt/sim/classifier-denied.sh"],
    assert: deniedUntouchedAssert,
  },
  {
    id: "classifier-denied-untouched-node24",
    requirement: "SIM-04",
    node: "24",
    image: `${TAG_NAMESPACE}:node24-tmuxgit`,
    user: "node",
    home: "/home/node",
    argv: ["/opt/sim/classifier-denied.sh"],
    assert: deniedUntouchedAssert,
  },
  {
    id: "uninstall-clean-box",
    requirement: "SIM-05",
    node: "22",
    image: `${TAG_NAMESPACE}:node22-tmuxgit`,
    argv: ["/opt/sim/uninstall-check.sh"],
    assert: uninstallCleanBoxAssert,
  },
];

/**
 * Abort the harness with an actionable message.
 * @param message What went wrong and what to do about it.
 */
function fail(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

/**
 * Run `docker` with an argv array, capturing its output.
 * @param args Argv passed to docker.
 * @param opts spawnSync overrides (timeout, killSignal, ...).
 * @returns The spawnSync result.
 */
function docker(args, opts = {}) {
  return spawnSync("docker", args, { encoding: "utf8", ...opts });
}

/**
 * Refuse to do anything before proving the daemon is up.
 * @remarks Without this, every failure downstream reads as a scenario/build defect rather than as
 * "Docker isn't running", which is the actual cause on a laptop that just booted.
 */
function requireDocker() {
  const probe = docker(["info", "--format", "{{.ServerVersion}}"]);
  if (probe.status !== 0) {
    fail(
      "Docker is not running — start Docker Desktop and re-run `npm run sim`",
    );
  }
  console.log(`  docker ${probe.stdout.trim()}`);
}

/**
 * Remove every image in this harness's tag namespace, and nothing else.
 * @remarks Scoped by construction (T-41-02): the id list comes from a `reference=dispatch-sim:*`
 * filter, so `docker rmi` is only ever handed ids this harness tagged. A prune/dangling sweep would
 * be shorter and is exactly what must never appear here — it would delete unrelated local images.
 */
function clean() {
  const ids = docker([
    "images",
    "--filter",
    `reference=${TAG_NAMESPACE}:*`,
    "-q",
  ]);
  const unique = [...new Set(ids.stdout.split("\n").filter(Boolean))];
  if (unique.length === 0) {
    console.log(`  nothing to clean — no ${TAG_NAMESPACE}:* images`);
    return;
  }
  const rm = docker(["rmi", "-f", ...unique], { stdio: "inherit" });
  if (rm.status !== 0) fail(`docker rmi failed for ${unique.join(" ")}`);
  console.log(`  removed ${unique.length} ${TAG_NAMESPACE}:* image(s)`);
}

/**
 * Build dist/ and pack this working tree into `stageDir`, returning the tarball's filename.
 * @param stageDir The docker build context to pack into.
 * @returns The packed tarball's file name inside stageDir.
 * @remarks The explicit `npm run build` is load-bearing and must not be "optimized" away: this
 * machine sets npm `ignore-scripts=true` globally, so the `prepack: npm run build` hook does NOT
 * fire and `npm pack` would happily package a stale or absent dist/. The file-list guard is what
 * makes the whole matrix trustworthy — an image built from a dist-less tarball fails every row for
 * a reason that has nothing to do with the code under test.
 */
function buildAndPack(stageDir) {
  console.log(
    "\n  building dist/ (prepack does not fire under ignore-scripts)",
  );
  const built = spawnSync("npm", ["run", "build"], {
    cwd: REPO_ROOT,
    stdio: "inherit",
  });
  if (built.status !== 0)
    fail("`npm run build` failed — cannot pack a tarball");

  console.log("  packing the working tree");
  const packed = spawnSync(
    "npm",
    ["pack", "--json", "--pack-destination", stageDir],
    { cwd: REPO_ROOT, encoding: "utf8" },
  );
  if (packed.status !== 0) fail(`\`npm pack\` failed:\n${packed.stderr}`);

  const start = packed.stdout.indexOf("[");
  if (start === -1)
    fail(`\`npm pack --json\` printed no JSON:\n${packed.stdout}`);
  let meta;
  try {
    meta = JSON.parse(packed.stdout.slice(start))[0];
  } catch (err) {
    fail(`could not parse \`npm pack --json\` output: ${err.message}`);
  }

  const entries = (meta.files ?? []).map((f) => f.path);
  if (!entries.includes(REQUIRED_TARBALL_ENTRY)) {
    fail(
      `packed tarball is missing ${REQUIRED_TARBALL_ENTRY} — dist/ is stale or absent, so every ` +
        `scenario would fail for the wrong reason. Run \`npm run build\` and check tsconfig.build.json.`,
    );
  }
  if (!existsSync(join(stageDir, meta.filename))) {
    fail(`npm pack reported ${meta.filename} but it is not in ${stageDir}`);
  }
  console.log(
    `  packed ${meta.filename} (${entries.length} files, ${REQUIRED_TARBALL_ENTRY} present)`,
  );
  return meta.filename;
}

/**
 * Copy the scenario scripts into the build context so the Dockerfile can COPY them to /opt/sim.
 * @param stageDir The docker build context.
 * @returns How many scripts were staged.
 * @remarks Staged as FILES rather than assembled into container command strings: a row's steps then
 * reach the container as a static `/opt/sim/<name>.sh` argv, and no host value ever lands on a shell
 * command line (T-41-05). An empty copy is a hard failure — the rows would all fail on a missing
 * entrypoint, which reads like a product defect but is a harness fault.
 */
function stageSimScripts(stageDir) {
  const dest = join(stageDir, "sim-scripts");
  mkdirSync(dest, { recursive: true });
  const scripts = readdirSync(SIM_DIR).filter((f) => f.endsWith(".sh"));
  if (scripts.length === 0) {
    fail(
      `no scenario scripts found in ${SIM_DIR} — every row would fail for the wrong reason`,
    );
  }
  for (const script of scripts) {
    copyFileSync(join(SIM_DIR, script), join(dest, script));
  }
  return scripts.length;
}

/**
 * Stage a docker build context in a fresh tmpdir and build every image from it.
 * @remarks A tmpdir context (never the repo root) keeps node_modules out of the build context and
 * leaves nothing behind to gitignore. A build failure is a harness fault, not a scenario result, so
 * it exits immediately rather than being recorded as a FAIL row.
 */
function buildImages() {
  const stageDir = mkdtempSync(join(tmpdir(), "dispatch-sim-"));
  try {
    const tarball = buildAndPack(stageDir);
    copyFileSync(join(stageDir, tarball), join(stageDir, "dispatch.tgz"));
    copyFileSync(DOCKERFILE, join(stageDir, "Dockerfile"));
    console.log(`  staged ${stageSimScripts(stageDir)} scenario script(s)`);

    for (const image of IMAGES) {
      console.log(`\n  building ${image.tag}`);
      const built = docker(
        [
          "build",
          "--build-arg",
          `NODE_VERSION=${image.node}`,
          "--build-arg",
          `TOOLS=${image.tools}`,
          "--build-arg",
          `PKG_MANAGER=${image.pkgManager}`,
          "-t",
          image.tag,
          stageDir,
        ],
        { stdio: "inherit" },
      );
      if (built.status !== 0) fail(`docker build failed for ${image.tag}`);
    }
    console.log(`\n  built ${IMAGES.length} images`);
  } finally {
    rmSync(stageDir, { recursive: true, force: true });
  }
}

/**
 * The one assertion primitive every row is built from: exit code plus required/forbidden substrings.
 * @param r The captured run: `{ code, output }`.
 * @param expectations `{ expectCode, present, absent }`.
 * @returns `{ ok, detail }` where detail NAMES every offending string, so a failure is diagnosable
 * without re-running or reading this file.
 */
function check(r, { expectCode, present = [], absent = [] }) {
  const problems = [];
  if (r.code !== expectCode) {
    problems.push(`exit code was ${r.code}, expected ${expectCode}`);
  }
  for (const needle of present) {
    if (!r.output.includes(needle)) problems.push(`missing: ${needle}`);
  }
  for (const needle of absent) {
    if (r.output.includes(needle)) {
      problems.push(`unexpectedly present: ${needle}`);
    }
  }
  return { ok: problems.length === 0, detail: problems.join("; ") };
}

/**
 * Parse the `SIM_KEY=value` tokens a scenario script printed.
 * @param output The container's combined stdout+stderr.
 * @returns A Map of KEY → value.
 * @remarks Rows grade tokens rather than scrape prose, so a reworded log line can never silently
 * flip a verdict. First occurrence wins: every key is emitted once by design, so a later line that
 * merely LOOKS like a token (a boot log echoing one back) cannot overwrite the real observation.
 */
function tokens(output) {
  const map = new Map();
  for (const line of output.split("\n")) {
    const m = /^SIM_([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && !map.has(m[1])) map.set(m[1], m[2]);
  }
  return map;
}

/** Turn a problem list into the `{ ok, detail }` verdict shape {@link check} returns. */
function grade(problems) {
  return { ok: problems.length === 0, detail: problems.join("; ") };
}

/** Combine two verdicts, keeping every diagnosis, so a row reports ALL of its failures at once. */
function both(a, b) {
  return {
    ok: a.ok && b.ok,
    detail: [a.detail, b.detail].filter(Boolean).join("; "),
  };
}

/**
 * Require a token to be present AND exactly equal to `expected`.
 * @remarks A MISSING token is a failure, never a pass — the scripts emit an explicit `none`/`no` on
 * their failure paths precisely so a row can never go green by matching absence against absence.
 */
function expectToken(t, key, expected, problems) {
  const actual = t.get(key);
  if (actual !== expected) {
    problems.push(
      `SIM_${key} was ${actual ?? "MISSING"}, expected ${expected}`,
    );
  }
}

/**
 * Grade the raw `/api/setup` body against what a genuinely fresh box must report.
 * @param raw The one-line JSON the probe captured.
 * @param expectedMajor The Node major this row's image is built on.
 * @remarks `node.version` is the load-bearing field: it is the container's OWN Node, so asserting it
 * is what proves the 22 and 24 rows ran on different engines rather than re-proving one twice.
 */
function setupBodyProblems(raw, expectedMajor) {
  if (!raw) return ["SIM_SETUP_BODY is MISSING — the probe never read a body"];
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return [`SIM_SETUP_BODY is not JSON: ${raw.slice(0, 200)}`];
  }
  const problems = [];
  if (body.needsKey !== true) {
    problems.push(
      `needsKey was ${body.needsKey}, expected true on a fresh box`,
    );
  }
  if (!Array.isArray(body.prerequisites) || body.prerequisites.length === 0) {
    problems.push("prerequisites was not a non-empty array");
  }
  if (body.node?.ok !== true) {
    problems.push(`node.ok was ${body.node?.ok}, expected true`);
  }
  const version = body.node?.version;
  if (typeof version !== "string" || !version.startsWith(`${expectedMajor}.`)) {
    problems.push(
      `node.version was ${version} — expected ${expectedMajor}.x; this row ran on the wrong image`,
    );
  }
  return problems;
}

/**
 * The SIM-03 row: a fresh install reaches the setup screen on this Node, with no native-module crash.
 * @param expectedMajor The Node major the image is built on.
 * @remarks One factory for both rows so the 22 and 24 claims can never drift apart — the ONLY
 * difference between them is the engine they run on, which is the whole point of running both.
 */
function bootSetupAssert(expectedMajor) {
  return (r) => {
    const t = tokens(r.output);
    const problems = setupBodyProblems(t.get("SETUP_BODY"), expectedMajor);
    expectToken(t, "SETUP_STATUS", "200", problems);
    expectToken(t, "HTML_STATUS", "200", problems);
    expectToken(t, "HTML_ROOT", "yes", problems);
    expectToken(t, "HTML_TITLE", "yes", problems);
    return both(
      check(r, {
        expectCode: 0,
        present: [
          "[server] Dispatch backend listening",
          "[preflight] storage OK",
        ],
        absent: NATIVE_CRASH_MARKERS,
      }),
      grade(problems),
    );
  };
}

/**
 * SIM-04 positive: genuine corruption is quarantined and recovered from the newest clean slot.
 * @remarks Asserts the bad primary was RENAMED (`board.db.corrupt` exists) rather than deleted, that
 * the slot it recovered FROM survives, and that boot still served the setup screen — a recovery that
 * crashed the boot would satisfy "did not lose data" while still leaving the user dead in the water.
 */
function corruptRecoversAssert(r) {
  const t = tokens(r.output);
  const problems = [];
  expectToken(t, "SETUP_STATUS", "200", problems);
  expectToken(t, "CORRUPT_MARKER", "yes", problems);
  expectToken(t, "BAK1_EXISTS", "yes", problems);
  expectToken(t, "DB_OPENS_CLEAN", "yes", problems);
  return both(
    check(r, {
      expectCode: 0,
      present: [
        "recovered board.db from",
        ".bak.1 after the primary was corrupt/unopenable",
        "[server] Dispatch backend listening",
      ],
      absent: NATIVE_CRASH_MARKERS,
    }),
    grade(problems),
  );
}

/**
 * SIM-04 negative: a permission-denied board.db fails loud and NOTHING is touched.
 * @remarks The digest comparison is the claim stated as arithmetic rather than as a hope — but two
 * MISSING digests would compare equal, so each is required to be a real sha256 first. `SIM_WHOAMI`
 * is asserted non-root because as root `chmod 000` is ignored: the row would then open the file
 * happily and report a green that means nothing at all.
 */
function deniedUntouchedAssert(r) {
  const t = tokens(r.output);
  const problems = [];
  const uid = t.get("WHOAMI");
  if (!uid || uid === "0") {
    problems.push(
      `SIM_WHOAMI was ${uid ?? "MISSING"} — this row is only valid as a non-root user, because root ignores chmod 000`,
    );
  }
  const exit = t.get("BOOT_EXIT");
  if (!/^[1-9][0-9]*$/.test(exit ?? "")) {
    problems.push(
      `SIM_BOOT_EXIT was ${exit ?? "MISSING"}, expected a non-zero exit code (boot must fail loud)`,
    );
  }
  expectToken(t, "CORRUPT_MARKER", "no", problems);
  expectToken(t, "DB_EXISTS", "yes", problems);
  for (const [before, after, what] of [
    ["DB_SHA_BEFORE", "DB_SHA_AFTER", "board.db"],
    ["BAK_SHA_BEFORE", "BAK_SHA_AFTER", "board.db.bak.1"],
  ]) {
    const a = t.get(before);
    const b = t.get(after);
    if (!/^[0-9a-f]{64}$/.test(a ?? "") || !/^[0-9a-f]{64}$/.test(b ?? "")) {
      problems.push(
        `${what} digests are not both real sha256 values (${a ?? "MISSING"} / ${b ?? "MISSING"})`,
      );
    } else if (a !== b) {
      problems.push(`${what} CHANGED across the denied boot: ${a} -> ${b}`);
    }
  }
  return both(
    check(r, {
      expectCode: 0,
      present: [
        "could not be opened and this is NOT corruption",
        "[preflight] storage check FAILED",
      ],
      absent: [
        "recovered board.db from",
        "quarantining and walking the backup",
      ],
    }),
    grade(problems),
  );
}

/**
 * SIM-05: uninstall removes its own footprint, keeps the user's data, and is idempotent.
 * @remarks The second run is graded on `Removed 0 file(s)` — a line only a genuine no-op can print,
 * since the first run reports 3 — plus the kept-paths no-op text. That text is `Nothing LEFT to stop
 * or remove` rather than `Nothing to stop or remove` precisely BECAUSE the board data survived: the
 * shorter sentence renders only on a box with nothing kept, so asserting it here would demand that
 * uninstall had eaten the data this row exists to prove it keeps.
 */
function uninstallCleanBoxAssert(r) {
  const t = tokens(r.output);
  const problems = [];
  const before = t.get("FOOTPRINT_BEFORE") ?? "";
  for (const artifact of ["config.json", "hook.sh", "hook-settings.json"]) {
    if (!before.includes(artifact)) {
      problems.push(
        `SIM_FOOTPRINT_BEFORE lacks ${artifact} — there was nothing to remove, so a clean "after" would prove nothing`,
      );
    }
  }
  expectToken(t, "UNINSTALL_EXIT", "0", problems);
  expectToken(t, "FOOTPRINT_AFTER", "none", problems);
  expectToken(t, "BOARD_DB_EXISTS", "yes", problems);
  expectToken(t, "BAK1_EXISTS", "yes", problems);
  expectToken(t, "DISPATCH_DIR_EXISTS", "yes", problems);
  expectToken(t, "SECOND_RUN_EXIT", "0", problems);
  return both(
    check(r, {
      expectCode: 0,
      present: [
        "Removed 3 file(s), stopped 0 session(s).",
        "/root/.dispatch/board.db  (board data — pass --purge to delete)",
        "npm uninstall -g @theyashgupta/dispatch",
        "Removed 0 file(s), stopped 0 session(s).",
        "Nothing left to stop or remove",
      ],
    }),
    grade(problems),
  );
}

/**
 * Run one scenario container and grade it.
 * @param scenario A row from {@link SCENARIOS}.
 * @returns The row plus `{ ok, detail, code, output }`.
 * @remarks Never throws and never exits: an assert that blows up becomes a FAIL row, because one
 * bad row must not rob the operator of the other rows' results. On timeout the container is force
 * removed by its OWN `dsp-sim-` name (T-41-02) — killing the docker CLI does not stop the container
 * it started, so without this a hung row would leak a container past the run.
 */
function runScenario(scenario) {
  const name = `${CONTAINER_PREFIX}${scenario.id}`;
  const argv = ["run", "--rm", "--name", name];
  if (scenario.user) {
    argv.push("--user", scenario.user, "-e", `HOME=${scenario.home}`);
  }
  argv.push(scenario.image, ...scenario.argv);

  const res = docker(argv, {
    timeout: RUN_TIMEOUT_MS,
    killSignal: "SIGKILL",
  });
  const output = `${res.stdout ?? ""}${res.stderr ?? ""}`;

  if (res.error) {
    docker(["rm", "-f", name]);
    const timedOut = res.error.code === "ETIMEDOUT" || res.signal === "SIGKILL";
    return {
      ...scenario,
      ok: false,
      code: res.status,
      output,
      detail: timedOut
        ? `timed out after ${RUN_TIMEOUT_MS}ms`
        : `docker run failed: ${res.error.message}`,
    };
  }

  let verdict;
  try {
    verdict = scenario.assert({ code: res.status, output });
  } catch (err) {
    verdict = { ok: false, detail: `assert threw: ${err.message}` };
  }
  return { ...scenario, code: res.status, output, ...verdict };
}

/**
 * Print the PASS/FAIL matrix and every failure's diagnosis.
 * @param results Graded rows.
 * @remarks Failing rows dump their (bounded) captured output so the operator can diagnose from the
 * one run rather than re-running with different flags.
 */
function report(results) {
  console.log("\n  SCENARIO MATRIX\n");
  for (const r of results) {
    const verdict = r.ok ? "PASS" : "FAIL";
    console.log(
      `  ${verdict}  ${r.id.padEnd(36)} node${r.node}  ${r.requirement}`,
    );
  }
  for (const r of results.filter((x) => !x.ok)) {
    console.log(`\n  ---- ${r.id} FAILED (exit ${r.code}) ----`);
    console.log(`  ${r.detail}`);
    const tail = r.output.split("\n").slice(-40).join("\n  ");
    console.log(`  ---- output (last 40 lines) ----\n  ${tail}`);
  }
  const passed = results.filter((r) => r.ok).length;
  console.log(
    `\n${passed === results.length ? "PASS" : "FAIL"}: ${passed}/${results.length} scenarios\n`,
  );
}

/**
 * Select the rows to run.
 * @param only Optional id substring.
 * @returns The matching rows.
 * @remarks Filters the MATRIX only — it can never weaken an assertion. Its purpose is that an agent
 * fixing one row does not pay for the whole matrix.
 */
function selectScenarios(only) {
  if (!only) return SCENARIOS;
  const picked = SCENARIOS.filter((s) => s.id.includes(only));
  if (picked.length === 0) {
    fail(
      `--only ${only} matched no scenario. Known ids:\n    ${SCENARIOS.map((s) => s.id).join("\n    ")}`,
    );
  }
  return picked;
}

const args = process.argv.slice(2);
const onlyIndex = args.indexOf("--only");
const only = onlyIndex === -1 ? null : args[onlyIndex + 1];

if (args.includes("--clean")) {
  requireDocker();
  clean();
  process.exit(0);
}

requireDocker();
buildImages();

if (args.includes("--build-only")) {
  process.exit(0);
}

const selected = selectScenarios(only);
const results = [];
for (const scenario of selected) {
  console.log(`\n  running ${scenario.id} (${scenario.image})`);
  results.push(runScenario(scenario));
}
report(results);
process.exit(results.every((r) => r.ok) ? 0 : 1);
