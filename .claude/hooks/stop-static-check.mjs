#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const STEPS = ["format:check", "lint", "typecheck", "depcruise"];
const TAIL_LINES = 40;
const TIMEOUT_MS = Number(process.env.DISPATCH_STOP_CHECK_TIMEOUT_MS) || 240000;
const KILL_GRACE_MS = 5000;
const NO_SLOT_CODE = 75;

/**
 * Tell if the stop must run the static checks.
 *
 * @remarks
 * `stop_hook_active` is true when an earlier block of this hook caused the turn, so skipping then prevents an endless block loop.
 */
function shouldCheck(payload, env, projectDir) {
  if (env.DISPATCH_SKIP_STOP_CHECK === "1") return false;
  if (payload?.stop_hook_active === true) return false;
  const status = spawnSync("git", ["status", "--porcelain"], {
    cwd: projectDir,
    encoding: "utf8",
  });
  return status.status === 0 && status.stdout.trim().length > 0;
}

/**
 * Run the static check steps and resolve with the exit code and the output lines.
 *
 * @remarks
 * The steps run in their own process group, so the timeout sends SIGTERM to the group, which the slot gate forwards to its command, and SIGKILL 5 seconds later if the group is still open. The slot wait limit is set 30 seconds below the timeout, so a busy slot gives up with exit 75 before the hook is killed only when the steps before it end within those 30 seconds. A timeout or a spawn error resolves with a null code.
 */
function runSteps(projectDir) {
  const env = { ...process.env };
  delete env.NODE_ENV;
  env.DISPATCH_CHECK_WAIT_SECONDS = String(
    Math.max(0, Math.floor(TIMEOUT_MS / 1000) - 30),
  );
  const child = spawn(STEPS.map((step) => `npm run ${step}`).join(" && "), {
    cwd: projectDir,
    env,
    shell: true,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));
  let timedOut = false;
  let killTimer;
  const signalGroup = (signal) => {
    try {
      process.kill(-child.pid, signal);
    } catch {
      return;
    }
  };
  const timer = setTimeout(() => {
    timedOut = true;
    signalGroup("SIGTERM");
    killTimer = setTimeout(() => signalGroup("SIGKILL"), KILL_GRACE_MS);
  }, TIMEOUT_MS);
  const clearTimers = () => {
    clearTimeout(timer);
    clearTimeout(killTimer);
  };
  return new Promise((done) => {
    child.on("error", () => {
      clearTimers();
      done({ code: null, lines: [] });
    });
    child.on("close", (code) => {
      clearTimers();
      done({
        code: timedOut ? null : code,
        lines: output.trimEnd().split("\n"),
      });
    });
  });
}

/**
 * Name the step that ran last before the failure.
 *
 * @remarks
 * npm prints a `> <package>@<version> <script>` header before each script, and the chain stops at the first failing step.
 */
function failingStep(lines) {
  let step = "unknown";
  for (const line of lines) {
    const header = /^> \S+@\S+ (\S+)$/.exec(line);
    if (header && STEPS.includes(header[1])) step = header[1];
  }
  return step;
}

/**
 * Collect the error lines of prettier, eslint, tsc and depcruise, up to the cap.
 *
 * @remarks
 * An eslint error line holds only the position and the rule, so the file header above it is joined to it.
 */
function errorLines(lines) {
  const found = [];
  let eslintFile = "";
  for (const line of lines) {
    if (/^\/.*\S$/.test(line)) eslintFile = line;
    if (/^\s+\d+:\d+\s+error\s/.test(line)) {
      found.push(`${eslintFile} ${line.trim()}`);
    } else if (
      /^\[warn\] /.test(line) ||
      /error TS\d+:/.test(line) ||
      /^\s*error\s+\S+:/.test(line) ||
      /dependency violations \([1-9]\d* errors?/.test(line) ||
      /^✖ \d+ problems? \([1-9]\d* errors?/.test(line)
    ) {
      found.push(line);
    }
  }
  return found.slice(0, TAIL_LINES);
}

try {
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  if (
    !shouldCheck(JSON.parse(readFileSync(0, "utf8")), process.env, projectDir)
  ) {
    process.exit(0);
  }
  const { code, lines } = await runSteps(projectDir);
  if (code === 0 || code === null) process.exit(0);
  const skipped = code === NO_SLOT_CODE;
  const report = [
    `The static checks failed in the step ${failingStep(lines)}. Fix these errors before you stop. Ask the user before you skip this check.`,
    "Error lines:",
    ...errorLines(lines),
    `Last ${TAIL_LINES} lines:`,
    ...lines.slice(-TAIL_LINES),
  ];
  process.stderr.write(
    skipped
      ? "Static checks skipped: no free check slot.\n"
      : `${report.join("\n")}\n`,
    () => process.exit(skipped ? 0 : 2),
  );
} catch {
  process.exit(0);
}
