/**
 * Reinstall persistence instrument (dev/ops tooling, NOT test code): imports no test framework,
 * defines no test cases, lives outside src/, the same category as scripts/check-invariants.mjs and
 * eslint.config.ts. Invoked by a human or an agent through one command, `npm run reinstall-sim`.
 *
 * It answers the question "a reinstall never loses your setup" mechanically, rather than as an
 * assertion nobody can check: it installs the real, published `v3.0.0` release and then this
 * working tree into an isolated `HOME` and npm prefix, and reports a PASS/FAIL matrix over three
 * legs (persistence, plist-staleness, uninstall-keeps).
 *
 * Modes:
 *   node scripts/reinstall-sim.mjs                      run every leg, print the matrix
 *   node scripts/reinstall-sim.mjs --only <leg>          run only the named leg
 *   node scripts/reinstall-sim.mjs --only <leg> --break <mode>
 *                                                         deliberately corrupt the leg's own
 *                                                         fixture so it demonstrably fails; a
 *                                                         self-check of the instrument, never a
 *                                                         normal run
 *
 * Two rules hold everywhere in this file. Every subprocess invocation is a spawnSync/execFileSync
 * argv ARRAY, never a shell string, nothing here is ever interpreted by a shell (T-41-01). And the
 * harness never calls `launchctl` for anything other than a read-only `print` (the single permitted
 * verb, enforced by this file's own Task 2 verify command), and never calls `installService` at all,
 * the plist is obtained only through `dispatch service install --print`, which is stdout-only and
 * makes zero `launchctl` calls of its own. A sandboxed `HOME` redirects the plist FILE and the
 * `~/.dispatch` DIRECTORY, but `launchctl bootstrap`'s `gui/<uid>` registration is a real, per-user
 * OS registry keyed by the plist's hardcoded `Label`, not by the path it was loaded from, so a real
 * `installService()`/`service install` call (without `--print`) inside this harness would clobber
 * the researcher's own live `com.dispatch.app` agent regardless of the sandbox.
 *
 * `board.db` and its `.bak.1` sidecar are seeded as OPAQUE FIXED BYTES, never a real SQLite file:
 * this harness never boots a server, so no WAL checkpoint or `VACUUM INTO` ever runs against them,
 * and the harness's own claim is narrower and stronger than a logical row diff, that the install
 * step does not touch these bytes at all. Byte equality over opaque bytes sidesteps the SQLite
 * page-layout false positive a raw diff of a real, booted database could otherwise produce.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SANDBOX_PREFIX = "dispatch-reinstall-sim-";
const OLD_RELEASE_TAG = "v3.0.0";
const REQUIRED_TARBALL_ENTRY = "dist/server/bootstrap/cli.js";
const PKG_NAME = "@theyashgupta/dispatch";
const FAKE_LINEAR_API_KEY = "lin_api_FAKE_NOT_REAL_00000000000000";

/**
 * Abort the harness with an actionable message. Reserved for setup failures (a bad build, a
 * missing tag) that make every leg's verdict meaningless, never for a leg's own violations, those
 * are collected and reported per leg instead.
 * @param message What went wrong and what to do about it.
 */
function fail(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

/**
 * The structural guarantee behind "never touches the real $HOME or a real npm prefix": called
 * before any filesystem write or subprocess spawn that touches a sandbox path. Throws rather than
 * silently degrading if any check fails.
 */
function assertSandboxSafe(dir) {
  if (dir === REPO_ROOT) {
    fail(`sandbox path ${dir} must never equal the repo root, refusing to proceed.`);
  }
  if (!dir.startsWith(tmpdir())) {
    fail(`sandbox path ${dir} must live under ${tmpdir()}, refusing to proceed.`);
  }
  if (!basename(dir).startsWith(SANDBOX_PREFIX)) {
    fail(
      `sandbox path ${dir} must have a basename starting with "${SANDBOX_PREFIX}", refusing to proceed.`,
    );
  }
}

/**
 * Fail closed while the user's real service is up (WR-08). Re-run at the top of every leg rather
 * than once per process, so a leg started after the service came back up still refuses.
 */
async function assertNoLiveService() {
  try {
    const res = await fetch("http://127.0.0.1:4700/api/board");
    await res.body?.cancel().catch(() => {});
    fail(
      "WR-08: a live dispatch service answered on :4700, refusing to proceed while the user's " +
        "real service is up.",
    );
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("WR-08")) throw err;
  }
}

/**
 * Create a disposable, sandbox-safe directory under `tmpdir()` with a unique suffix.
 * @param label A short name folded into the directory's basename for readability in logs.
 */
function mkSandboxDir(label) {
  const dir = mkdtempSync(join(tmpdir(), `${SANDBOX_PREFIX}${label}-`));
  assertSandboxSafe(dir);
  return dir;
}

/**
 * Build the current working tree and pack it, mirroring `fresh-env-sim.mjs`'s `buildAndPack`.
 * `npm run build` runs explicitly rather than relying on `prepack`, which does not fire under an
 * `ignore-scripts=true` npm config. `npm pack` itself also runs with `--ignore-scripts`, on a
 * machine where scripts are NOT ignored, `prepack` would otherwise re-run the build and print
 * vite's progress output (including raw ANSI escapes) onto the same stdout `--json` parses,
 * corrupting the JSON this function depends on. The explicit build above already makes `dist/`
 * current, so skipping `prepack` here loses nothing.
 * @param stageDir Destination directory for the packed tarball.
 * @returns The absolute path to the packed tarball.
 */
function buildAndPack(stageDir) {
  console.log("\n  building dist/ (prepack does not fire under ignore-scripts)");
  const built = spawnSync("npm", ["run", "build"], { cwd: REPO_ROOT, stdio: "inherit" });
  if (built.status !== 0) fail("`npm run build` failed, cannot pack a tarball");

  console.log("  packing the working tree");
  const packed = spawnSync(
    "npm",
    ["pack", "--json", "--ignore-scripts", "--pack-destination", stageDir],
    { cwd: REPO_ROOT, encoding: "utf8" },
  );
  if (packed.status !== 0) fail(`\`npm pack\` failed:\n${packed.stderr}`);

  const start = packed.stdout.indexOf("[");
  if (start === -1) fail(`\`npm pack --json\` printed no JSON:\n${packed.stdout}`);
  let meta;
  try {
    meta = JSON.parse(packed.stdout.slice(start))[0];
  } catch (err) {
    fail(`could not parse \`npm pack --json\` output: ${err.message}`);
  }

  const entries = (meta.files ?? []).map((f) => f.path);
  if (!entries.includes(REQUIRED_TARBALL_ENTRY)) {
    fail(
      `packed tarball is missing ${REQUIRED_TARBALL_ENTRY}, dist/ is stale or absent. Run ` +
        `\`npm run build\` and check tsconfig.build.json.`,
    );
  }
  const tarballPath = join(stageDir, meta.filename);
  if (!existsSync(tarballPath)) {
    fail(`npm pack reported ${meta.filename} but it is not in ${stageDir}`);
  }
  console.log(`  packed ${meta.filename} (${entries.length} files, ${REQUIRED_TARBALL_ENTRY} present)`);
  return tarballPath;
}

/**
 * Materialize {@link OLD_RELEASE_TAG} into a tag-keyed tmpdir cache via `git archive`, never `git
 * worktree`, extracting a tar leaves the working repository's git state untouched. Builds it once
 * and reuses the compiled tree across runs (a tag is immutable, so the cache is always valid), but
 * always re-packs, packing is cheap and this keeps the returned tarball's mtime fresh.
 * @returns The absolute path to the packed OLD-release tarball.
 */
function buildOldRelease() {
  const treeRoot = join(tmpdir(), `${SANDBOX_PREFIX}release-${OLD_RELEASE_TAG}`);
  assertSandboxSafe(treeRoot);
  const builtEntry = join(treeRoot, REQUIRED_TARBALL_ENTRY);

  if (existsSync(builtEntry)) {
    console.log(`\n  preflight: reusing cached ${OLD_RELEASE_TAG} build at ${builtEntry}`);
  } else {
    console.log(`\n  preflight: materializing ${OLD_RELEASE_TAG} from the git tag`);
    rmSync(treeRoot, { recursive: true, force: true });
    mkdirSync(treeRoot, { recursive: true });
    const tarPath = `${treeRoot}.tar`;
    try {
      const tar = execFileSync("git", ["archive", "--format=tar", OLD_RELEASE_TAG], {
        cwd: REPO_ROOT,
        maxBuffer: 512 * 1024 * 1024,
      });
      writeFileSync(tarPath, tar);
      execFileSync("tar", ["-xf", tarPath, "-C", treeRoot], { stdio: "pipe" });
    } catch (err) {
      fail(
        `could not materialize ${OLD_RELEASE_TAG}, the sim needs the real published release and ` +
          `will not substitute a stand-in for it: ${err.message}`,
      );
    } finally {
      rmSync(tarPath, { force: true });
    }
    try {
      execFileSync("npm", ["ci", "--no-audit", "--no-fund"], { cwd: treeRoot, stdio: "pipe" });
      execFileSync("npm", ["run", "build"], { cwd: treeRoot, stdio: "pipe" });
    } catch (err) {
      const detail = [err.stdout?.toString(), err.stderr?.toString()]
        .filter(Boolean)
        .join("\n")
        .trim();
      fail(`could not build ${OLD_RELEASE_TAG}:\n${detail || err.message}`);
    }
    if (!existsSync(builtEntry)) {
      fail(`Missing ${builtEntry} after building ${OLD_RELEASE_TAG}.`);
    }
    console.log(`  built ${OLD_RELEASE_TAG} from the git tag -> ${builtEntry}`);
  }

  const stageDir = join(tmpdir(), `${SANDBOX_PREFIX}release-${OLD_RELEASE_TAG}-pack`);
  assertSandboxSafe(stageDir);
  rmSync(stageDir, { recursive: true, force: true });
  mkdirSync(stageDir, { recursive: true });
  const packed = spawnSync(
    "npm",
    ["pack", "--json", "--ignore-scripts", "--pack-destination", stageDir],
    { cwd: treeRoot, encoding: "utf8" },
  );
  if (packed.status !== 0) fail(`\`npm pack\` on ${OLD_RELEASE_TAG} failed:\n${packed.stderr}`);
  const start = packed.stdout.indexOf("[");
  const meta = JSON.parse(packed.stdout.slice(start))[0];
  const entries = (meta.files ?? []).map((f) => f.path);
  if (!entries.includes(REQUIRED_TARBALL_ENTRY)) {
    fail(`packed ${OLD_RELEASE_TAG} tarball is missing ${REQUIRED_TARBALL_ENTRY}`);
  }
  const tarballPath = join(stageDir, meta.filename);
  console.log(`  packed ${OLD_RELEASE_TAG} -> ${tarballPath}`);
  return tarballPath;
}

/**
 * Allocate the three sandbox directories one install generation needs: the shared `HOME` and one
 * npm prefix per generation (`prefix-old`, `prefix-new`), each verified sandbox-safe.
 */
function makeSandbox() {
  const home = mkSandboxDir("home");
  const prefixOld = mkSandboxDir("prefix-old");
  const prefixNew = mkSandboxDir("prefix-new");
  return { home, prefixOld, prefixNew };
}

/**
 * Seed a representative `~/.dispatch` under the sandbox `HOME`: `config.json` (mode 0600, holding a
 * port, launch args, and an obviously fake Linear key), two playbooks, `board.db`/`board.db.bak.1`
 * as opaque fixed bytes (see the file header), and the dispatch-owned regenerables
 * (`hook.sh`/`hook-settings.json`) the uninstall leg expects to see removed.
 * @returns The seeded `<home>/.dispatch` directory path.
 */
function seedDispatchDir(home) {
  const dispatchDir = join(home, ".dispatch");
  mkdirSync(join(dispatchDir, "playbooks"), { recursive: true });
  writeFileSync(
    join(dispatchDir, "config.json"),
    JSON.stringify(
      {
        port: 47844,
        launchArgs: ["--no-open"],
        sources: { linear: { apiKey: FAKE_LINEAR_API_KEY } },
      },
      null,
      2,
    ) + "\n",
    { mode: 0o600 },
  );
  writeFileSync(
    join(dispatchDir, "playbooks", "kickoff.md"),
    "# Kickoff\n\nSeeded fixture playbook, reinstall-sim.mjs.\n",
  );
  writeFileSync(
    join(dispatchDir, "playbooks", "review.md"),
    "# Review\n\nSeeded fixture playbook, reinstall-sim.mjs.\n",
  );
  writeFileSync(
    join(dispatchDir, "board.db"),
    Buffer.from([0xd0, 0x0f, 0xca, 0xfe, 0x00, 0x01, 0x02, 0x03, 0x04]),
  );
  writeFileSync(
    join(dispatchDir, "board.db.bak.1"),
    Buffer.from([0xd0, 0x0f, 0xca, 0xfe, 0x0b, 0xa1, 0x01, 0x02]),
  );
  writeFileSync(join(dispatchDir, "hook.sh"), "#!/bin/sh\necho seeded-hook\n");
  writeFileSync(join(dispatchDir, "hook-settings.json"), JSON.stringify({ seeded: true }) + "\n");
  return dispatchDir;
}

/**
 * Recursively walk `<home>/.dispatch` and hash every file, stdlib only, no diff dependency.
 * @returns A sorted `Map` of relative path to its sha256 digest.
 */
function snapshotDispatchDir(home) {
  const root = join(home, ".dispatch");
  const snap = new Map();
  const walk = (dir) => {
    const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        const rel = relative(root, full);
        const hash = createHash("sha256").update(readFileSync(full)).digest("hex");
        snap.set(rel, hash);
      }
    }
  };
  if (existsSync(root)) walk(root);
  return new Map([...snap.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

/**
 * Compare two directory snapshots, reporting every relative path that was added, removed, or
 * changed between them.
 * @returns Human-readable violation lines, empty when the two snapshots are identical.
 */
function diffSnapshots(before, after) {
  const violations = [];
  for (const [rel, hash] of before) {
    if (!after.has(rel)) violations.push(`removed: ${rel}`);
    else if (after.get(rel) !== hash) violations.push(`changed: ${rel}`);
  }
  for (const rel of after.keys()) {
    if (!before.has(rel)) violations.push(`added: ${rel}`);
  }
  return violations;
}

/**
 * Install a packed tarball into an isolated npm prefix under a sandboxed `HOME`, verifying the
 * prefix is sandbox-safe first and that `<prefix>/bin/dispatch` exists afterward.
 * @returns The absolute path to the installed `dispatch` binary.
 */
function installTarball(tarball, prefix, home) {
  assertSandboxSafe(prefix);
  const result = spawnSync("npm", ["install", "-g", "--prefix", prefix, tarball], {
    env: { ...process.env, HOME: home, npm_config_prefix: prefix },
    encoding: "utf8",
  });
  if (result.status !== 0) {
    fail(`npm install -g --prefix ${prefix} ${tarball} failed:\n${result.stderr}`);
  }
  const bin = join(prefix, "bin", "dispatch");
  if (!existsSync(bin)) {
    fail(`npm install reported success but ${bin} does not exist`);
  }
  return bin;
}

/**
 * Run the installed `dispatch` binary from `prefix` against the sandboxed `HOME`, never through a
 * shell (argv array, T-41-01).
 * @returns `{ status, stdout, stderr }` from the run.
 */
function dispatchArgv(prefix, args, home) {
  const bin = join(prefix, "bin", "dispatch");
  const result = spawnSync(bin, args, {
    env: { ...process.env, HOME: home },
    encoding: "utf8",
  });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

/**
 * PERSIST-01: install {@link OLD_RELEASE_TAG} then the current tree into one isolated sandbox and
 * prove `~/.dispatch` is byte-identical to its seed across both installs.
 * @param opts.break `"mutate-config"` corrupts one byte of `config.json` between the two installs,
 * demonstrating the leg can fail on the exact condition it exists to catch.
 * @returns Violation lines, empty on PASS.
 */
async function legPersistence(opts = {}) {
  await assertNoLiveService();
  const violations = [];
  const { home, prefixOld, prefixNew } = makeSandbox();
  const newPackDir = mkSandboxDir("new-pack");
  try {
    seedDispatchDir(home);
    const snap0 = snapshotDispatchDir(home);
    console.log(
      `  seed: ${snap0.size} file(s) under ~/.dispatch, config.json sha256=${snap0.get("config.json")}`,
    );

    const oldTarball = buildOldRelease();
    installTarball(oldTarball, prefixOld, home);
    let snap1 = snapshotDispatchDir(home);
    console.log(
      `  after ${OLD_RELEASE_TAG} install: ${snap1.size} file(s), config.json sha256=${snap1.get("config.json")}`,
    );
    for (const v of diffSnapshots(snap0, snap1)) {
      violations.push(`after ${OLD_RELEASE_TAG} install: ${v}`);
    }

    if (opts.break === "mutate-config") {
      const configPath = join(home, ".dispatch", "config.json");
      const buf = readFileSync(configPath);
      buf[0] = buf[0] ^ 0xff;
      writeFileSync(configPath, buf);
      console.log(`  --break mutate-config: flipped one byte of config.json between snapshots`);
    }

    const newTarball = buildAndPack(newPackDir);
    installTarball(newTarball, prefixNew, home);
    const snap2 = snapshotDispatchDir(home);
    console.log(
      `  after current-build install: ${snap2.size} file(s), config.json sha256=${snap2.get("config.json")}`,
    );
    for (const v of diffSnapshots(snap0, snap2)) {
      violations.push(`after current-build install: ${v}`);
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(prefixOld, { recursive: true, force: true });
    rmSync(prefixNew, { recursive: true, force: true });
    rmSync(newPackDir, { recursive: true, force: true });
  }
  return violations;
}

/** The leg registry `--only` and the default all-legs run both dispatch through. */
const LEGS = {
  persistence: legPersistence,
};

async function main() {
  const args = process.argv.slice(2);
  const onlyIndex = args.indexOf("--only");
  const only = onlyIndex >= 0 ? args[onlyIndex + 1] : undefined;
  const breakIndex = args.indexOf("--break");
  const breakMode = breakIndex >= 0 ? args[breakIndex + 1] : undefined;

  if (only && !LEGS[only]) {
    console.error(
      `usage: node scripts/reinstall-sim.mjs [--only <${Object.keys(LEGS).join("|")}>] [--break <mode>]`,
    );
    process.exit(1);
  }

  const names = only ? [only] : Object.keys(LEGS);
  let anyFail = false;
  for (const name of names) {
    console.log(`\n=== leg: ${name} ===`);
    const violations = await LEGS[name]({ break: breakMode });
    if (violations.length > 0) {
      anyFail = true;
      console.log(`FAIL (${name})`);
      for (const v of violations) console.log(`  ${v}`);
    } else {
      console.log(`PASS (${name})`);
    }
  }
  process.exit(anyFail ? 1 : 0);
}

main().catch((err) => {
  console.error(`reinstall-sim failed: ${err.stack ?? err.message}`);
  process.exit(1);
});
