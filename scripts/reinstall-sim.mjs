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
 *
 * Observed failing-direction evidence (Phase 97 plan 06, live runs against the current build):
 * `persistence` was proven able to fail with `--break mutate-config`, which flips one byte of
 * `config.json` between the two installs and reports `FAIL (persistence)` naming
 * `after current-build install: changed: config.json`. `plist-staleness` was proven able to fail
 * with `--break stale-plist-uncorrected`, which skips the first heal call and reports
 * `FAIL (plist-staleness)` with `second healServicePlist call reported "rewritten", expected
 * "unchanged"` and `the plist changed on the second heal call, a repeat call must be a
 * byte-identical no-op`. `uninstall-keeps` was proven able to fail by its own leg logic: the real
 * `v3.0.0` `--dry-run Remove:` section lists `config.json` before the current build's fix ever
 * runs, the same shipped bug this leg exists to catch.
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
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SANDBOX_PREFIX = "dispatch-reinstall-sim-";
const OLD_RELEASE_TAG = "v3.0.0";
const REQUIRED_TARBALL_ENTRY = "dist/server/bootstrap/cli.js";
const PKG_NAME = "@theyashgupta/dispatch";
const FAKE_LINEAR_API_KEY = "lin_api_FAKE_NOT_REAL_00000000000000";
/** The launchd label the plist-staleness leg's one read-only `launchctl print` targets. */
const SERVICE_LABEL = "com.dispatch.app";

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
    fail(
      `sandbox path ${dir} must never equal the repo root, refusing to proceed.`,
    );
  }
  if (!dir.startsWith(tmpdir())) {
    fail(
      `sandbox path ${dir} must live under ${tmpdir()}, refusing to proceed.`,
    );
  }
  if (!basename(dir).startsWith(SANDBOX_PREFIX)) {
    fail(
      `sandbox path ${dir} must have a basename starting with "${SANDBOX_PREFIX}", refusing to proceed.`,
    );
  }
}

/**
 * Fail closed while the user's real service is up (WR-08). Re-run at the top of every leg rather
 * than once per process, so a leg started after the service came back up still refuses. Probes the
 * default port AND the port in the user's real `config.json` (read-only), since a service on a
 * configured port is exactly as live as one on 4700.
 */
async function assertNoLiveService() {
  const ports = new Set([4700]);
  try {
    const cfg = JSON.parse(
      readFileSync(join(homedir(), ".dispatch", "config.json"), "utf8"),
    );
    if (typeof cfg.port === "number") ports.add(cfg.port);
  } catch {}
  for (const port of ports) {
    let answered = false;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/board`);
      await res.body?.cancel().catch(() => {});
      answered = true;
    } catch {}
    if (answered) {
      fail(
        `WR-08: a live dispatch service answered on :${port}, refusing to proceed while the ` +
          `user's real service is up.`,
      );
    }
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
  console.log(
    "\n  building dist/ (prepack does not fire under ignore-scripts)",
  );
  const built = spawnSync("npm", ["run", "build"], {
    cwd: REPO_ROOT,
    stdio: "inherit",
  });
  if (built.status !== 0) fail("`npm run build` failed, cannot pack a tarball");

  console.log("  packing the working tree");
  const packed = spawnSync(
    "npm",
    ["pack", "--json", "--ignore-scripts", "--pack-destination", stageDir],
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
      `packed tarball is missing ${REQUIRED_TARBALL_ENTRY}, dist/ is stale or absent. Run ` +
        `\`npm run build\` and check tsconfig.build.json.`,
    );
  }
  const tarballPath = join(stageDir, meta.filename);
  if (!existsSync(tarballPath)) {
    fail(`npm pack reported ${meta.filename} but it is not in ${stageDir}`);
  }
  console.log(
    `  packed ${meta.filename} (${entries.length} files, ${REQUIRED_TARBALL_ENTRY} present)`,
  );
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
  const treeRoot = join(
    tmpdir(),
    `${SANDBOX_PREFIX}release-${OLD_RELEASE_TAG}`,
  );
  assertSandboxSafe(treeRoot);
  const builtEntry = join(treeRoot, REQUIRED_TARBALL_ENTRY);

  if (existsSync(builtEntry)) {
    console.log(
      `\n  preflight: reusing cached ${OLD_RELEASE_TAG} build at ${builtEntry}`,
    );
  } else {
    console.log(
      `\n  preflight: materializing ${OLD_RELEASE_TAG} from the git tag`,
    );
    rmSync(treeRoot, { recursive: true, force: true });
    mkdirSync(treeRoot, { recursive: true });
    const tarPath = `${treeRoot}.tar`;
    try {
      const tar = execFileSync(
        "git",
        ["archive", "--format=tar", OLD_RELEASE_TAG],
        {
          cwd: REPO_ROOT,
          maxBuffer: 512 * 1024 * 1024,
        },
      );
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
      execFileSync("npm", ["ci", "--no-audit", "--no-fund"], {
        cwd: treeRoot,
        stdio: "pipe",
      });
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

  const stageDir = join(
    tmpdir(),
    `${SANDBOX_PREFIX}release-${OLD_RELEASE_TAG}-pack`,
  );
  assertSandboxSafe(stageDir);
  rmSync(stageDir, { recursive: true, force: true });
  mkdirSync(stageDir, { recursive: true });
  const packed = spawnSync(
    "npm",
    ["pack", "--json", "--ignore-scripts", "--pack-destination", stageDir],
    { cwd: treeRoot, encoding: "utf8" },
  );
  if (packed.status !== 0)
    fail(`\`npm pack\` on ${OLD_RELEASE_TAG} failed:\n${packed.stderr}`);
  const start = packed.stdout.indexOf("[");
  const meta = JSON.parse(packed.stdout.slice(start))[0];
  const entries = (meta.files ?? []).map((f) => f.path);
  if (!entries.includes(REQUIRED_TARBALL_ENTRY)) {
    fail(
      `packed ${OLD_RELEASE_TAG} tarball is missing ${REQUIRED_TARBALL_ENTRY}`,
    );
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
  writeFileSync(
    join(dispatchDir, "hook-settings.json"),
    JSON.stringify({ seeded: true }) + "\n",
  );
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
        const hash = createHash("sha256")
          .update(readFileSync(full))
          .digest("hex");
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
  const result = spawnSync(
    "npm",
    ["install", "-g", "--prefix", prefix, tarball],
    {
      env: { ...process.env, HOME: home, npm_config_prefix: prefix },
      encoding: "utf8",
    },
  );
  if (result.status !== 0) {
    fail(
      `npm install -g --prefix ${prefix} ${tarball} failed:\n${result.stderr}`,
    );
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
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
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
      console.log(
        `  --break mutate-config: flipped one byte of config.json between snapshots`,
      );
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

/**
 * Extract the ordered `ProgramArguments` string values from a rendered plist. No XML parser: the
 * plist schema is generated exclusively by this codebase's own `buildPlist` (`service.ts`), so a
 * narrow scan of its known shape is enough. A local copy rather than an import, `service.ts`'s own
 * `extractProgramArguments` is not exported, and this harness must read the plist independently of
 * the code it is verifying.
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
    values.push(
      match[1]
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, "&"),
    );
  }
  return values;
}

/**
 * The final non-empty line of `text`. `healServicePlist` writes its own log line to stdout before
 * the `node -e` script's `console.log(r)` prints the return value on the line after it, so the
 * return value is always the LAST line, never the whole trimmed output.
 */
function lastLine(text) {
  const lines = text.split("\n").filter((l) => l.trim() !== "");
  return lines.length > 0 ? lines[lines.length - 1].trim() : "";
}

/**
 * Read-only `launchctl print` of the real `com.dispatch.app` registration, the single permitted
 * `launchctl` verb anywhere in this file (enforced by this file's own Task 2 verify command). Used
 * only to prove the plist-staleness leg never touched the real registration: called once before
 * and once after the leg's work, the two outputs must be identical.
 */
function capturePrintState(uid) {
  const printArgs = ["print", `gui/${uid}/${SERVICE_LABEL}`];
  const result = spawnSync("launchctl", printArgs, { encoding: "utf8" });
  return `${result.status}:${result.stdout}${result.stderr}`;
}

/**
 * PERSIST-03: prove a prefix change genuinely moves the resolved `cli.js` path, then prove the
 * current build's self-heal repairs a plist stuck at the old path and is a no-op on a second call.
 * The plist is obtained only through `dispatch service install --print` (stdout-only, zero
 * `launchctl` calls of its own), never through a real `service install`.
 * @param opts.break `"stale-plist-uncorrected"` skips the first heal call and asserts the second
 * call's success criteria anyway, demonstrating the leg fails on the exact condition it exists to
 * catch.
 * @returns Violation lines, empty on PASS.
 */
async function legPlistStaleness(opts = {}) {
  await assertNoLiveService();
  const violations = [];
  const uid = process.getuid?.();
  const { home, prefixOld, prefixNew } = makeSandbox();
  const newPackDir = mkSandboxDir("new-pack");
  try {
    const printBefore = capturePrintState(uid);

    const oldTarball = buildOldRelease();
    installTarball(oldTarball, prefixOld, home);
    const newTarball = buildAndPack(newPackDir);
    installTarball(newTarball, prefixNew, home);

    const plistPath = join(
      home,
      "Library",
      "LaunchAgents",
      "com.dispatch.app.plist",
    );
    mkdirSync(dirname(plistPath), { recursive: true });

    const oldRender = dispatchArgv(
      prefixOld,
      ["service", "install", "--print"],
      home,
    );
    if (oldRender.status !== 0) {
      violations.push(
        `${OLD_RELEASE_TAG} \`service install --print\` exited ${oldRender.status}`,
      );
    }
    const oldArgs = extractProgramArguments(oldRender.stdout);

    const newRender = dispatchArgv(
      prefixNew,
      ["service", "install", "--print"],
      home,
    );
    if (newRender.status !== 0) {
      violations.push(
        `current build \`service install --print\` exited ${newRender.status}`,
      );
    }
    const newArgs = extractProgramArguments(newRender.stdout);

    console.log(`  ${OLD_RELEASE_TAG} cli.js path: ${oldArgs[1]}`);
    console.log(`  current build cli.js path: ${newArgs[1]}`);
    if (oldArgs[1] === newArgs[1]) {
      violations.push(
        `the two prefixes rendered the SAME cli.js path (${oldArgs[1]}), this leg cannot prove ` +
          `staleness without two genuinely different paths`,
      );
    }

    writeFileSync(plistPath, oldRender.stdout);

    const healEntry = join(
      prefixNew,
      "lib",
      "node_modules",
      PKG_NAME,
      "dist",
      "server",
      "services",
      "orchestration",
      "service.js",
    );
    const healScript =
      `import(${JSON.stringify(pathToFileURL(healEntry).href)})` +
      `.then((m) => m.healServicePlist())` +
      `.then((r) => console.log(r))`;
    const runHeal = () =>
      spawnSync(process.execPath, ["--input-type=module", "-e", healScript], {
        env: { ...process.env, HOME: home },
        encoding: "utf8",
      });

    if (opts.break !== "stale-plist-uncorrected") {
      const healResult = runHeal();
      const outcome = lastLine(healResult.stdout);
      console.log(
        `  heal call 1: ${outcome || "(no output)"}` +
          (healResult.stderr
            ? `\n    stderr: ${healResult.stderr.trim()}`
            : ""),
      );
      if (outcome !== "rewritten") {
        violations.push(
          `first healServicePlist call reported "${outcome}", expected "rewritten"`,
        );
      }
      const healedArgs = extractProgramArguments(
        readFileSync(plistPath, "utf8"),
      );
      if (healedArgs[1] !== newArgs[1]) {
        violations.push(
          `after the first heal, the plist's cli.js path is "${healedArgs[1]}", expected "${newArgs[1]}"`,
        );
      }
    }

    const digestBeforeSecondCall = createHash("sha256")
      .update(readFileSync(plistPath))
      .digest("hex");
    const healResult2 = runHeal();
    const outcome2 = lastLine(healResult2.stdout);
    console.log(
      `  heal call 2: ${outcome2 || "(no output)"}` +
        (healResult2.stderr
          ? `\n    stderr: ${healResult2.stderr.trim()}`
          : ""),
    );
    if (outcome2 !== "unchanged") {
      violations.push(
        `second healServicePlist call reported "${outcome2}", expected "unchanged"`,
      );
    }
    const digestAfterSecondCall = createHash("sha256")
      .update(readFileSync(plistPath))
      .digest("hex");
    if (digestAfterSecondCall !== digestBeforeSecondCall) {
      violations.push(
        `the plist changed on the second heal call, a repeat call must be a byte-identical no-op`,
      );
    }

    const printAfter = capturePrintState(uid);
    if (printAfter !== printBefore) {
      violations.push(
        `launchctl print gui/${uid}/${SERVICE_LABEL} changed during this leg, the real ` +
          `registration must never be touched`,
      );
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(prefixOld, { recursive: true, force: true });
    rmSync(prefixNew, { recursive: true, force: true });
    rmSync(newPackDir, { recursive: true, force: true });
  }
  return violations;
}

/**
 * Slice one `renderPlan` section (`"Remove:"`, `"Keep:"`, `"Stop:"`) out of a `--dry-run`/`--yes`
 * transcript. `renderPlan` (`uninstall.ts`) always terminates a non-empty section with one blank
 * line, which is what bounds the slice here.
 * @returns The section's body lines joined by `\n`, empty string when the header is absent.
 */
function extractSection(text, header) {
  const lines = text.split("\n");
  const startIndex = lines.findIndex((l) => l.trim() === header);
  if (startIndex === -1) return "";
  const out = [];
  for (let i = startIndex + 1; i < lines.length; i++) {
    if (lines[i].trim() === "") break;
    out.push(lines[i]);
  }
  return out.join("\n");
}

/** Indent every line of `text` by four spaces, for nesting a transcript excerpt under a log line. */
function indent(text) {
  return text
    .split("\n")
    .map((l) => `    ${l}`)
    .join("\n");
}

/**
 * PERSIST-02: prove the shipped {@link OLD_RELEASE_TAG} bug (bare uninstall deletes `config.json`)
 * reproduces, then prove the current build's bare `uninstall --yes` keeps `config.json`/board
 * data/playbooks byte-identical while removing only the dispatch-owned regenerables
 * (`hook.sh`/`hook-settings.json`), stopping neither tmux sessions nor ttyd.
 * @returns Violation lines, empty on PASS.
 */
async function legUninstallKeeps(opts = {}) {
  await assertNoLiveService();
  const violations = [];
  const { home, prefixOld, prefixNew } = makeSandbox();
  const newPackDir = mkSandboxDir("new-pack");
  try {
    seedDispatchDir(home);
    const oldTarball = buildOldRelease();
    installTarball(oldTarball, prefixOld, home);
    const newTarball = buildAndPack(newPackDir);
    installTarball(newTarball, prefixNew, home);

    const plistPath = join(
      home,
      "Library",
      "LaunchAgents",
      "com.dispatch.app.plist",
    );
    rmSync(plistPath, { force: true });
    if (existsSync(plistPath)) {
      violations.push(
        `refusing to run uninstall: ${plistPath} still exists after an attempted delete, a live ` +
          `plist could cause runUninstall to boot out the real agent`,
      );
      return violations;
    }

    writeFileSync(
      join(home, ".dispatch", "hook.sh"),
      "#!/bin/sh\necho reseeded-hook\n",
    );
    writeFileSync(
      join(home, ".dispatch", "hook-settings.json"),
      JSON.stringify({ seeded: true }) + "\n",
    );
    const snapBefore = snapshotDispatchDir(home);
    console.log(
      `  before uninstall: ${snapBefore.size} file(s) under ~/.dispatch`,
    );

    const oldDryRun = dispatchArgv(prefixOld, ["uninstall", "--dry-run"], home);
    const oldRemoveSection = extractSection(oldDryRun.stdout, "Remove:");
    console.log(
      `  ${OLD_RELEASE_TAG} --dry-run Remove: section:\n${indent(oldRemoveSection)}`,
    );
    if (!oldRemoveSection.includes("config.json")) {
      violations.push(
        `${OLD_RELEASE_TAG}'s bare --dry-run Remove: section does not list config.json, this ` +
          `leg's fail-first premise (the shipped bug) did not reproduce`,
      );
    }

    const newDryRun = dispatchArgv(prefixNew, ["uninstall", "--dry-run"], home);
    const newKeepSection = extractSection(newDryRun.stdout, "Keep:");
    const newRemoveSection = extractSection(newDryRun.stdout, "Remove:");
    const newStopSection = extractSection(newDryRun.stdout, "Stop:");
    console.log(
      `  current build --dry-run Keep: section:\n${indent(newKeepSection)}`,
    );
    console.log(
      `  current build --dry-run Remove: section:\n${indent(newRemoveSection)}`,
    );
    console.log(
      `  current build --dry-run Stop: section:\n${indent(newStopSection || "(empty)")}`,
    );

    if (!newKeepSection.includes("config.json")) {
      violations.push(
        `current build's --dry-run Keep: section does not list config.json`,
      );
    }
    if (newRemoveSection.includes("config.json")) {
      violations.push(
        `current build's --dry-run Remove: section lists config.json, it must stay under --purge only`,
      );
    }
    const removeBasenames = newRemoveSection
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => l.split("/").pop());
    const unexpectedRemoves = removeBasenames.filter(
      (b) => b !== "hook.sh" && b !== "hook-settings.json",
    );
    if (unexpectedRemoves.length > 0) {
      violations.push(
        `current build's --dry-run Remove: section lists unexpected entries: ${unexpectedRemoves.join(", ")}`,
      );
    }
    const stopHasSessionOrTtyd =
      newStopSection.includes("tmux session") ||
      newStopSection.includes("ttyd");
    if (stopHasSessionOrTtyd) {
      violations.push(
        `current build's --dry-run Stop: section is not empty (a tmux session or ttyd line is ` +
          `present): ${newStopSection}`,
      );
      violations.push(
        `refusing to run uninstall --yes: the preceding --dry-run's Stop: section was not empty`,
      );
      return violations;
    }

    const execResult = dispatchArgv(prefixNew, ["uninstall", "--yes"], home);
    console.log(`  current build uninstall --yes exit=${execResult.status}`);

    const snapAfter = snapshotDispatchDir(home);
    const keepChecks = [
      "config.json",
      "board.db",
      "board.db.bak.1",
      join("playbooks", "kickoff.md"),
      join("playbooks", "review.md"),
    ];
    for (const rel of keepChecks) {
      if (snapBefore.get(rel) !== snapAfter.get(rel)) {
        violations.push(
          `${rel} did not survive uninstall --yes byte-identical (before=` +
            `${snapBefore.get(rel) ?? "absent"}, after=${snapAfter.get(rel) ?? "absent"})`,
        );
      }
    }
    for (const rel of ["hook.sh", "hook-settings.json"]) {
      if (snapAfter.has(rel)) {
        violations.push(
          `${rel} still exists after uninstall --yes, it is a dispatch-owned regenerable and ` +
            `must be removed`,
        );
      }
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
  "plist-staleness": legPlistStaleness,
  "uninstall-keeps": legUninstallKeeps,
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
