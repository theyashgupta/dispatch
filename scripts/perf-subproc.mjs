/**
 * Subprocess-load harness (PERF-01b, dev/ops tooling, NOT test code): boots the production build
 * with `DISPATCH_PERF_EXEC=1` (see src/server/adapters/exec.ts's env-gated instrumentation of the
 * sole `run()` chokepoint — NEW-11, execa was never installed), holds a fixed drive window, then
 * SIGTERMs the child and reads back the `DISPATCH_PERF_EXEC_DUMP` line it wrote to stderr.
 *
 * `--window=0` gives the BOOT-ONLY profile (preflight probes, hook-capability checks, editor
 * resolution — every `run()` call that fires before `/api/board` answers 200). Any `--window=N>0`
 * additionally holds the process open for N seconds so the 2s marker-watcher tick can run; with
 * zero live sessions (this sandbox never starts one) and `statusChannel: "auto"`, the watcher scans
 * zero cards per tick, so a near-zero steady-state delta over the boot-only profile is an EXPECTED,
 * valid finding — not a harness bug.
 *
 * Usage:
 *   node scripts/perf-subproc.mjs               120s drive window (default)
 *   node scripts/perf-subproc.mjs --window=0     boot-only profile
 *   node scripts/perf-subproc.mjs --window=30    30s drive window
 *
 * Prints a per-cmd breakdown table, then a machine-parsable summary:
 *   PERF-SUBPROC window_s=<n> calls=<n> total_ms=<n> calls_per_min=<n>
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST_ENTRY = join(REPO_ROOT, "dist", "server", "bootstrap", "index.js");
const PORT = 4858;
const POLL_INTERVAL_MS = 25;
const READY_TIMEOUT_MS = 30_000;
const KILL_TIMEOUT_MS = 5_000;
const DUMP_PREFIX = "DISPATCH_PERF_EXEC_DUMP ";

/** Read `--window=N` (seconds) off argv, defaulting to a 120s drive window. */
function readWindowFlag(argv) {
  const flag = argv.find((a) => a.startsWith("--window="));
  if (!flag) return 120;
  const n = Number(flag.slice("--window=".length));
  if (!Number.isFinite(n) || n < 0) {
    console.error(`--window must be a non-negative number, got: ${flag}`);
    process.exit(1);
  }
  return n;
}

/** Same deterministic scratch-HOME shape as perf-boot.mjs, so the boot profile the two harnesses see is identical. */
function makeSandboxHome(label) {
  const home = join(tmpdir(), `dispatch-perf-${label}-${process.pid}`);
  const dispatchDir = join(home, ".dispatch");
  mkdirSync(dispatchDir, { recursive: true });
  writeFileSync(
    join(dispatchDir, "config.json"),
    JSON.stringify(
      {
        port: PORT,
        workspaceRoot: join(home, "workspaces"),
        statusChannel: "auto",
        updateCheck: false,
      },
      null,
      2,
    ) + "\n",
    { mode: 0o600 },
  );
  return home;
}

/** Poll `GET /api/board` until it returns 200, or reject after `READY_TIMEOUT_MS`. */
async function waitForReady() {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/api/board`);
      await res.body?.cancel();
      if (res.status === 200) return;
    } catch {
      // server not listening yet — keep polling
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(
    `server did not answer 200 on /api/board within ${READY_TIMEOUT_MS}ms`,
  );
}

/**
 * Boot the production server with perf-exec instrumentation on, wait for readiness, hold the drive
 * window, then SIGTERM it and capture the `DISPATCH_PERF_EXEC_DUMP` line from its stderr.
 * @param home Sandbox HOME.
 * @param windowSeconds Seconds to hold the process open after readiness (0 = boot-only profile).
 * @returns The parsed dump payload `{ calls, total, byCmd }`.
 */
async function driveOnce(home, windowSeconds) {
  const child = spawn("node", [DIST_ENTRY], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      HOME: home,
      DISPATCH_PERF_EXEC: "1",
    },
    stdio: ["ignore", "ignore", "pipe"],
  });

  let stderrBuf = "";
  child.stderr.on("data", (chunk) => {
    stderrBuf += chunk.toString("utf8");
  });

  await waitForReady();
  if (windowSeconds > 0) {
    await new Promise((r) => setTimeout(r, windowSeconds * 1000));
  }

  const exited = new Promise((resolve) => child.once("exit", resolve));
  const escalate = setTimeout(() => child.kill("SIGKILL"), KILL_TIMEOUT_MS);
  child.kill("SIGTERM");
  await exited;
  clearTimeout(escalate);

  const line = stderrBuf.split("\n").find((l) => l.startsWith(DUMP_PREFIX));
  if (!line) {
    throw new Error(
      `no ${DUMP_PREFIX.trim()} line found in child stderr — instrumentation did not fire`,
    );
  }
  return JSON.parse(line.slice(DUMP_PREFIX.length));
}

function fmt(n) {
  return n.toFixed(1);
}

function printDump(label, dump, windowSeconds) {
  console.log(`\n${label} (window=${windowSeconds}s)`);
  const cmds = Object.keys(dump.byCmd).sort();
  if (cmds.length === 0) {
    console.log("  (no run() calls recorded)");
  } else {
    console.log(
      "  cmd".padEnd(20) + "count".padStart(8) + "total_ms".padStart(12),
    );
    for (const cmd of cmds) {
      const { count, ms } = dump.byCmd[cmd];
      console.log(
        cmd.padEnd(20) + String(count).padStart(8) + fmt(ms).padStart(12),
      );
    }
  }
  const callsPerMin = windowSeconds > 0 ? (dump.calls / windowSeconds) * 60 : 0;
  console.log(
    `PERF-SUBPROC window_s=${windowSeconds} calls=${dump.calls} total_ms=${fmt(dump.total)} calls_per_min=${fmt(callsPerMin)}`,
  );
  return callsPerMin;
}

async function main() {
  if (!existsSync(DIST_ENTRY)) {
    console.error(`Missing ${DIST_ENTRY} — run \`npm run build\` first.`);
    process.exit(1);
  }

  const windowSeconds = readWindowFlag(process.argv.slice(2));
  const home = makeSandboxHome("subproc");

  try {
    const dump = await driveOnce(home, windowSeconds);
    printDump("PERF-SUBPROC dump", dump, windowSeconds);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(`perf-subproc failed: ${err.stack ?? err.message}`);
  process.exit(1);
});
