import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, mock, test } from "node:test";
import { isolateEnv } from "../../test-support/fixtures.js";
import { writeConnectorClaude } from "../../test-support/stub-claude.js";

const env = isolateEnv();
const stubDir = path.join(env.root, "stub");
fs.mkdirSync(stubDir);
process.env.CONNECTOR_STUB_DIR = stubDir;
writeConnectorClaude(env.binDir);

mock.timers.enable({ apis: ["setTimeout"] });

const { store } = await import("../../store/board.store.js");
const { setOrchestrationConfig } = await import("../infra/config-holder.js");
const {
  applySlackSettings,
  runSlackNow,
  slackMcpStatus,
  startSlackRound,
  stopSlackRound,
} = await import("./slack-round.js");
await store.load();

const MINUTE = 60_000;
const CONNECTED = "claude.ai Slack: https://mcp.slack.com/mcp - ✔ Connected\n";
const EMPTY = JSON.stringify({
  type: "result",
  is_error: false,
  result: JSON.stringify({ messages: [] }),
});

after(async () => {
  mock.timers.reset();
  await stopSlackRound();
  env.cleanup();
});

function configure(
  mode: "mcp" | "token",
  mcpIntervalMinutes?: unknown,
  fakeMode = "reply",
): void {
  setOrchestrationConfig({
    linearApiKey: "",
    sources: {
      slack: {
        enabled: true,
        mode,
        ...(mcpIntervalMinutes === undefined
          ? {}
          : { mcpIntervalMinutes: mcpIntervalMinutes as number }),
      },
    },
  });
  for (const f of ["calls.log", "claude.pid"]) {
    fs.rmSync(path.join(stubDir, f), { force: true });
  }
  fs.writeFileSync(path.join(stubDir, "mcp-list.txt"), CONNECTED);
  fs.writeFileSync(path.join(stubDir, "reply.json"), EMPTY);
  fs.writeFileSync(path.join(stubDir, "mode"), fakeMode);
}

function rounds(): number {
  try {
    return fs
      .readFileSync(path.join(stubDir, "calls.log"), "utf8")
      .split("\n")
      .filter((l) => l === "call").length;
  } catch {
    return 0;
  }
}

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

async function idle(): Promise<void> {
  const end = Date.now() + 7000;
  while ((await slackMcpStatus()).running && Date.now() < end) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  for (let i = 0; i < 50; i += 1) await new Promise((r) => setImmediate(r));
  assert.equal((await slackMcpStatus()).running, false);
}

test("K1 no cursor runs a round at boot, then none before 30 minutes and one at 30 minutes", async () => {
  await store.setSourceCursors("slack", {});
  configure("mcp");
  await startSlackRound();
  mock.timers.tick(0);
  assert.ok(await until(() => rounds() === 1));
  await idle();
  mock.timers.tick(30 * MINUTE - 1);
  assert.ok(!(await until(() => rounds() === 2, 300)));
  mock.timers.tick(1);
  assert.ok(await until(() => rounds() === 2));
  await idle();
  await stopSlackRound();
});

test("K2 mcpIntervalMinutes 45 waits 45 minutes, 5 and 1440 are kept, and 2, 4, 1441 or a string wait 30", async () => {
  for (const [value, minutes] of [
    [45, 45],
    [2, 30],
    ["x", 30],
    [4, 30],
    [1441, 30],
    [5, 5],
    [1440, 1440],
  ] as const) {
    await stopSlackRound();
    configure("mcp", value);
    const at = new Date().toISOString();
    await store.setSourceCursors("slack", {
      mcp: { cursor: at, polledAt: at },
    });
    await startSlackRound();
    mock.timers.tick(minutes * MINUTE - MINUTE);
    assert.ok(!(await until(() => rounds() === 1, 300)), String(value));
    mock.timers.tick(MINUTE);
    assert.ok(await until(() => rounds() === 1), String(value));
    await idle();
  }
  await stopSlackRound();
});

test("K3 switching from mcp to token stops the timer and aborts a running round", async () => {
  await store.setSourceCursors("slack", {});
  configure("mcp", undefined, "sleep");
  await startSlackRound();
  mock.timers.tick(0);
  assert.ok(await until(() => stubPid() > 0));
  const pid = stubPid();
  assert.ok(alive(pid));
  assert.equal((await slackMcpStatus()).running, true);
  configure("token");
  await applySlackSettings({ mode: "mcp", enabled: true });
  assert.ok(!alive(pid));
  assert.equal((await slackMcpStatus()).running, false);
  mock.timers.tick(120 * MINUTE);
  assert.ok(!(await until(() => rounds() > 0, 300)));
});

test("K4 a timer that fires during a Run now claim starts no second round", async () => {
  await stopSlackRound();
  const at = new Date().toISOString();
  await store.setSourceCursors("slack", { mcp: { cursor: at, polledAt: at } });
  configure("mcp");
  await startSlackRound();
  const run = runSlackNow();
  mock.timers.tick(30 * MINUTE);
  assert.equal(await run, "started");
  assert.ok(await until(() => rounds() >= 1));
  await idle();
  assert.equal(rounds(), 1);
  await stopSlackRound();
});

test("K5 a stop that lands while the timer is arming leaves no timer", async () => {
  await stopSlackRound();
  await store.setSourceCursors("slack", {});
  configure("mcp");
  const arming = startSlackRound();
  const stopping = stopSlackRound();
  await Promise.all([arming, stopping]);
  mock.timers.tick(120 * MINUTE);
  assert.ok(!(await until(() => rounds() > 0, 300)));
});

test("K6 a round that times out records timeout and arms the next round", async () => {
  await stopSlackRound();
  await store.setSourceCursors("slack", {});
  configure("mcp", undefined, "sleep");
  await startSlackRound();
  mock.timers.tick(0);
  assert.ok(await until(() => rounds() === 1));
  mock.timers.tick(300_000);
  await idle();
  assert.equal((await slackMcpStatus()).lastError, "timeout");
  mock.timers.tick(30 * MINUTE);
  assert.ok(await until(() => rounds() === 2));
  await stopSlackRound();
});

test("K7 turning rounds on with no cursor starts a round at once", async () => {
  await stopSlackRound();
  await store.setSourceCursors("slack", {});
  configure("mcp");
  await applySlackSettings({ mode: "token", enabled: true });
  assert.ok(await until(() => rounds() === 1));
  await idle();
  await stopSlackRound();
});

test("K8 applying settings with the timer already armed starts no second round", async () => {
  await stopSlackRound();
  await store.setSourceCursors("slack", {});
  configure("mcp");
  await startSlackRound();
  await applySlackSettings({ mode: "mcp", enabled: true });
  assert.ok(!(await until(() => rounds() > 0, 300)));
  mock.timers.tick(0);
  assert.ok(await until(() => rounds() === 1));
  await idle();
  assert.equal(rounds(), 1);
  await stopSlackRound();
});
