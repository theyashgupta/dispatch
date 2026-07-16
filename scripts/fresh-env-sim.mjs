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
import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DOCKERFILE = join(REPO_ROOT, "scripts", "sim", "Dockerfile");

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
      `  ${verdict}  ${r.id.padEnd(30)} node${r.node}  ${r.requirement}`,
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
