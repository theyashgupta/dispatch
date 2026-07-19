/**
 * Cold-boot repeat-run timing harness (PERF-01a, dev/ops tooling, NOT test code): imports no test
 * framework, asserts nothing about app runtime behavior, and lives outside src/ — the same category
 * as check-invariants.mjs and fresh-env-sim.mjs.
 *
 * It answers one question the source can't: how long does the PRODUCTION build actually take, cold,
 * from `node dist/server/bootstrap/index.js` to the first successful `GET /api/board` 200? Every run
 * boots against an isolated sandbox HOME (a scratch `~/.dispatch/config.json` with no `linearApiKey`,
 * so the poller never starts and every run is deterministic) — the real `~/.dispatch` is never read
 * or written. One warmup run is discarded (the true first-ever boot pays one-time seeding: playbook
 * seed, hook-artifact install, fresh board.db creation) before N measured runs.
 *
 * Usage:
 *   node scripts/perf-boot.mjs               10 measured runs (default)
 *   node scripts/perf-boot.mjs --runs=3       override the run count
 *
 * Prints one line per run, then a machine-parsable summary:
 *   PERF-BOOT n=<N> mean=<ms> p50=<ms> p95=<ms>
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

/** Read `--runs=N` off argv, defaulting to 10 measured runs (one additional warmup always precedes them). */
function readRunsFlag(argv) {
  const flag = argv.find((a) => a.startsWith("--runs="));
  if (!flag) return 10;
  const n = Number(flag.slice("--runs=".length));
  if (!Number.isInteger(n) || n < 1) {
    console.error(`--runs must be a positive integer, got: ${flag}`);
    process.exit(1);
  }
  return n;
}

/**
 * Build a fresh scratch `HOME` with a minimal, deterministic `~/.dispatch/config.json`: no
 * `linearApiKey` (poller stays off), `updateCheck: false` (no outbound network hit contaminates
 * boot timing), a scratch `workspaceRoot`, and the fixed harness port.
 * @returns The sandbox HOME path.
 */
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
      if (res.status === 200) {
        await res.body?.cancel();
        return;
      }
      await res.body?.cancel();
    } catch {
      // server not listening yet — keep polling
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(
    `server did not answer 200 on /api/board within ${READY_TIMEOUT_MS}ms`,
  );
}

/** SIGTERM the child and wait for it to exit, escalating to SIGKILL if it doesn't within `KILL_TIMEOUT_MS`. */
function killAndWait(child) {
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

/** Boot the production server once against `home`, time to first 200, then kill it. Returns elapsed ms. */
async function oneBoot(home) {
  const t0 = performance.now();
  const child = spawn("node", [DIST_ENTRY], {
    env: { ...process.env, NODE_ENV: "production", HOME: home },
    stdio: ["ignore", "ignore", "ignore"],
  });
  const crashed = new Promise((_, reject) => {
    child.once("exit", (code, signal) => {
      if (code !== 0 && code !== null) {
        reject(
          new Error(`server exited early (code=${code}, signal=${signal})`),
        );
      }
    });
  });
  try {
    await Promise.race([waitForReady(), crashed]);
  } finally {
    // keep racing crashed() alive without an unhandled rejection once waitForReady() wins
    crashed.catch(() => {});
  }
  const ms = performance.now() - t0;
  await killAndWait(child);
  return ms;
}

function percentile(sorted, p) {
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx];
}

function fmt(ms) {
  return ms.toFixed(1);
}

async function main() {
  if (!existsSync(DIST_ENTRY)) {
    console.error(`Missing ${DIST_ENTRY} — run \`npm run build\` first.`);
    process.exit(1);
  }

  const runs = readRunsFlag(process.argv.slice(2));
  const home = makeSandboxHome("boot");

  try {
    console.log(`warmup: booting once (discarded)...`);
    const warmupMs = await oneBoot(home);
    console.log(`  warmup  ${fmt(warmupMs)}ms (discarded)`);

    const timings = [];
    for (let i = 1; i <= runs; i++) {
      const ms = await oneBoot(home);
      timings.push(ms);
      console.log(`  run ${String(i).padStart(2, "0")}  ${fmt(ms)}ms`);
    }

    const sorted = [...timings].sort((a, b) => a - b);
    const mean = timings.reduce((a, b) => a + b, 0) / timings.length;
    const p50 = percentile(sorted, 0.5);
    const p95 = percentile(sorted, 0.95);

    console.log(
      `\nPERF-BOOT n=${runs} mean=${fmt(mean)} p50=${fmt(p50)} p95=${fmt(p95)}`,
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(`perf-boot failed: ${err.stack ?? err.message}`);
  process.exit(1);
});
