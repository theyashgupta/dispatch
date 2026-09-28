import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, mock, test } from "node:test";
import { isolateEnv } from "../test-support/fixtures.js";

const env = isolateEnv();
const stubDir = path.join(env.root, "stub");
fs.mkdirSync(stubDir);
process.env.STUB_DIR = stubDir;
fs.writeFileSync(
  path.join(env.binDir, "claude"),
  [
    "#!/bin/sh",
    'if [ "$1" = mcp ]; then',
    '  case "$(cat "$STUB_DIR/mcp")" in',
    '  connected) echo "claude.ai Granola: https://mcp.granola.ai/mcp (HTTP) - ✔ Connected" ;;',
    '  needs-auth) echo "claude.ai Granola: https://mcp.granola.ai/mcp (HTTP) - ! Needs authentication" ;;',
    "  esac",
    "  exit 0",
    "fi",
    'echo $$ > "$STUB_DIR/claude.pid"',
    'echo run >> "$STUB_DIR/runs.txt"',
    "cat > /dev/null",
    'case "$(cat "$STUB_DIR/mode")" in',
    "none) echo NO_ACTION_ITEMS ;;",
    "slow) exec sleep 400 ;;",
    "esac",
  ].join("\n"),
  { mode: 0o755 },
);

mock.timers.enable({ apis: ["setTimeout"] });

const { store } = await import("../store/board.store.js");
const { setOrchestrationConfig, getOrchestrationConfig } =
  await import("../services/infra/config-holder.js");
const {
  applyGranolaSettings,
  checkGranolaConnection,
  granolaStatus,
  runGranolaNow,
  stopGranolaRound,
} = await import("../services/orchestration/granola-round.js");
const express = (await import("express")).default;
const { meetingsRouter } = await import("./meetings.route.js");
await store.load();
setOrchestrationConfig({
  linearApiKey: "",
  sources: { meeting: { enabled: true, windowHours: 48 } },
});

const app = express();
app.use("/api", express.json(), meetingsRouter);
const server = await new Promise<import("node:http").Server>((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;

after(async () => {
  mock.timers.reset();
  await stopGranolaRound();
  server.close();
  env.cleanup();
});

const HOUR = 60 * 60 * 1000;

function stub(mcp: string, mode: string): void {
  fs.writeFileSync(path.join(stubDir, "mcp"), mcp);
  fs.writeFileSync(path.join(stubDir, "mode"), mode);
  fs.rmSync(path.join(stubDir, "claude.pid"), { force: true });
}

function runs(): number {
  const file = path.join(stubDir, "runs.txt");
  return fs.existsSync(file)
    ? fs.readFileSync(file, "utf8").trim().split("\n").length
    : 0;
}

/**
 * The stub's pid, or 0 while its pid file is missing or not yet written.
 *
 * @remarks The stub writes the file with a shell redirect, so it can exist empty for a moment;
 * `Number("")` is 0, and `process.kill(0, 0)` probes the whole process group and always succeeds.
 */
function stubPid(): number {
  try {
    return Number(fs.readFileSync(path.join(stubDir, "claude.pid"), "utf8"));
  } catch {
    return 0;
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function until(check: () => boolean, ms = 7000): Promise<boolean> {
  const end = Date.now() + ms;
  while (!check() && Date.now() < end) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  return check();
}

function meeting(patch: { enabled?: boolean; windowHours?: number }): void {
  const sources = getOrchestrationConfig()?.sources ?? {};
  sources.meeting = { ...sources.meeting, ...patch };
}

test("a finished round re-arms the hourly timer and the next round runs an hour later", async () => {
  stub("connected", "none");
  assert.equal(runGranolaNow(), "started");
  assert.ok(await until(() => runs() === 1 && !granolaStatus().running));
  mock.timers.tick(HOUR - 1);
  assert.ok(!(await until(() => runs() === 2, 300)));
  mock.timers.tick(1);
  assert.ok(await until(() => runs() === 2 && !granolaStatus().running));
});

test("a round past 300 s ends as timeout with the child gone", async () => {
  stub("connected", "slow");
  mock.timers.tick(HOUR);
  assert.ok(await until(() => stubPid() > 0));
  const pid = stubPid();
  assert.ok(alive(pid));
  mock.timers.tick(300_000);
  assert.ok(await until(() => !granolaStatus().running));
  assert.equal(granolaStatus().lastError, "timeout");
  assert.ok(!alive(pid));
});

test("Analyze now answers 409 running through the route while a round runs", async () => {
  stub("connected", "slow");
  mock.timers.tick(HOUR);
  assert.ok(await until(() => stubPid() > 0));
  const res = await fetch(`${base}/meetings/granola/run`, { method: "POST" });
  assert.equal(res.status, 409);
  assert.deepEqual(await res.json(), { error: "running" });
  meeting({ enabled: false });
  await applyGranolaSettings({ enabled: true, windowHours: 48 });
  assert.equal(granolaStatus().running, false);
});

test("re-enabling with the same window and no cursor is already running when the apply resolves", async () => {
  await store.setSourceCursors("meeting", {});
  stub("connected", "none");
  const before = runs();
  meeting({ enabled: true });
  await applyGranolaSettings({ enabled: false, windowHours: 48 });
  assert.equal(granolaStatus().running, true);
  assert.ok(
    await until(() => runs() === before + 1 && !granolaStatus().running),
  );
});

test("check connection answers each mcp list state, through the service and the route", async () => {
  stub("connected", "none");
  assert.deepEqual(await checkGranolaConnection(), {
    state: "connected",
    server: "claude.ai Granola",
  });
  stub("needs-auth", "none");
  assert.deepEqual(await checkGranolaConnection(), {
    state: "needs-auth",
    server: "claude.ai Granola",
  });
  stub("absent", "none");
  const res = await fetch(`${base}/meetings/granola/check`, {
    method: "POST",
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { state: "not-found" });
});

async function set(patch: {
  enabled?: boolean;
  windowHours?: number;
}): Promise<void> {
  const current = getOrchestrationConfig()?.sources?.meeting;
  const previous = {
    enabled: current?.enabled === true,
    windowHours: current?.windowHours ?? 48,
  };
  meeting(patch);
  await applyGranolaSettings(previous);
}

test("re-enabling with a fresh cursor waits for the hour instead of running at once", async () => {
  stub("connected", "none");
  await set({ enabled: true });
  assert.ok(await until(() => !granolaStatus().running));
  assert.equal(runGranolaNow(), "started");
  assert.ok(await until(() => !granolaStatus().running));
  await set({ enabled: false });
  const before = runs();
  await set({ enabled: true });
  assert.equal(granolaStatus().running, false);
  assert.ok(!(await until(() => runs() > before, 300)));
  mock.timers.tick(HOUR);
  assert.ok(
    await until(() => runs() === before + 1 && !granolaStatus().running),
  );
});

test("while off no timer runs, even hours later", async () => {
  stub("connected", "none");
  await set({ enabled: false });
  const before = runs();
  mock.timers.tick(3 * HOUR);
  assert.ok(!(await until(() => runs() > before, 300)));
  assert.equal(runGranolaNow(), "disabled");
});
