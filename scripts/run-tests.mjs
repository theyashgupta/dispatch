import { spawnSync } from "node:child_process";
import { existsSync, globSync } from "node:fs";

const TIMING_FILES = [
  "scripts/with-check-slot.test.mjs",
  "src/server/adapters/calendar-helper.test.ts",
  "src/server/adapters/exec.test.ts",
  "src/server/adapters/markers/status-line.test.ts",
  "src/server/adapters/markers/watcher-meters-tick.test.ts",
  "src/server/adapters/markers/watcher-pane-sink.test.ts",
  "src/server/adapters/markers/watcher-scope.test.ts",
  "src/server/adapters/poller.test.ts",
  "src/server/adapters/tmux-env.test.ts",
  "src/server/adapters/tmux-pane-border.test.ts",
  "src/server/adapters/tmux-session-env.test.ts",
  "src/server/adapters/tmux-window-size.test.ts",
  "src/server/bootstrap/boot-resume-tmux.test.ts",
  "src/server/routes/decisions-route.test.ts",
  "src/server/routes/orchestrator-sessions-route.test.ts",
  "src/server/routes/session-input-route.test.ts",
  "src/server/services/domain/loop-progress.test.ts",
  "src/server/services/domain/prd-progress.test.ts",
  "src/server/services/orchestration/orchestrator-launch-tmux.test.ts",
  "src/server/services/orchestration/orchestrator-wait.test.ts",
  "src/server/services/orchestration/orchestrator-wake.test.ts",
  "src/server/services/orchestration/pause-resume-input.test.ts",
  "src/server/services/orchestration/resume-session.test.ts",
  "src/server/services/orchestration/run-claude.test.ts",
  "src/server/services/orchestration/session-account-move.test.ts",
  "src/server/services/orchestration/session-account-restart.test.ts",
  "src/server/services/orchestration/start-session-reattach.test.ts",
  "src/server/services/orchestration/steps.test.ts",
  "src/server/services/orchestration/supervisor-actions.test.ts",
  "src/server/services/orchestration/supervisor-handoff-orchestrator.test.ts",
  "src/server/services/orchestration/supervisor-handoff.test.ts",
  "src/server/services/orchestration/supervisor-limit.test.ts",
  "src/server/services/orchestration/supervisor-record.test.ts",
  "src/server/services/orchestration/supervisor-send.test.ts",
  "src/server/sources/calendar/ics.test.ts",
  "src/server/test-support/fake-claude-tui.test.ts",
  "src/server/test-support/hooks-subagent-pause.test.ts",
  "src/shared/profile.test.ts",
];

const WEB_ENV = { TSX_TSCONFIG_PATH: "src/web/tsconfig.json" };

const UNIT_PASSES = [
  { patterns: ["src/server/**/*.test.ts", "src/shared/**/*.test.ts"] },
  { patterns: ["src/web/**/*.test.ts"], env: WEB_ENV },
  { patterns: ["eslint-local/**/*.test.ts"] },
  { patterns: ["scripts/**/*.test.mjs"] },
];

/**
 * Run `node --test` on the files and return the exit code.
 *
 * @remarks
 * Only TypeScript files load tsx, so the `.mjs` script tests run under plain Node as they always did.
 */
function nodeTest(files, env = {}) {
  const tsx = files.some((file) => file.endsWith(".ts"))
    ? ["--import", "tsx"]
    : [];
  const result = spawnSync(process.execPath, [...tsx, "--test", ...files], {
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  return result.status ?? 1;
}

/**
 * Run each unit pass on its files minus the timing files, and stop at the first failed pass.
 */
function unit() {
  const timing = new Set(TIMING_FILES);
  for (const { patterns, env } of UNIT_PASSES) {
    const files = patterns
      .flatMap((pattern) => globSync(pattern))
      .filter((file) => !timing.has(file))
      .sort();
    const code = nodeTest(files, env);
    if (code !== 0) return code;
  }
  return 0;
}

/**
 * Run each timing file alone, one after another, and run a failed file one more time.
 *
 * @remarks
 * A timing file fails the run only when it fails twice in a row, because a single failure of a tmux or wall-clock test is most often load from another suite on the machine. A listed file that does not exist fails the run, so a rename never drops a test from both suites.
 */
function timing(files) {
  const missing = files.filter((file) => !existsSync(file));
  if (missing.length > 0) {
    console.error(`test:timing: listed files not found: ${missing.join(", ")}`);
    return 2;
  }
  const failed = [];
  for (const file of files) {
    const env = file.startsWith("src/web/") ? WEB_ENV : {};
    if (nodeTest([file], env) === 0) continue;
    console.error(`test:timing: ${file} failed, retrying once`);
    if (nodeTest([file], env) !== 0) failed.push(file);
  }
  if (failed.length > 0) {
    console.error(`test:timing: failed twice: ${failed.join(", ")}`);
    return 1;
  }
  return 0;
}

const [mode, ...files] = process.argv.slice(2);
if (mode === "unit") process.exit(unit());
if (mode === "timing") {
  process.exit(timing(files.length > 0 ? files : TIMING_FILES));
}
console.error("usage: run-tests.mjs unit | timing [files...]");
process.exit(2);
