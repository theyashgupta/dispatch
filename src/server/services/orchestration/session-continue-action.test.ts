import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { isolateEnv } from "../../test-support/fixtures.js";
import {
  BUSY_PANE,
  LIMIT_PANE,
  installFakeTmux,
} from "../../test-support/fake-tmux.js";
import { DEFAULT_BOARD_KEY } from "../../../shared/board-key.js";

const DEAD_USAGE_URL = "http://127.0.0.1:1/usage";
process.env.DISPATCH_USAGE_URL = DEAD_USAGE_URL;
const env = isolateEnv();
const fake = installFakeTmux(env);

const { store } = await import("../../store/board.store.js");
const { upsertAccount, accountDir } = await import("./claude-accounts.js");
const { listAccountSessions } = await import("./claude-account-ops.js");
const { forgetUsage, refreshUsage } = await import("./claude-usage.js");
const { setHooksRuntime } = await import("../infra/config-holder.js");
setHooksRuntime({ capable: true, port: 1, statusChannel: "auto" });

const ACCOUNT_A = "11111111-1111-4111-8111-111111111111";
await upsertAccount({
  id: ACCOUNT_A,
  email: "a@example.com",
  orgId: "org",
  orgName: "Org",
  subscriptionType: "max",
  createdAt: "2026-10-01T00:00:00.000Z",
  lastLoginAt: "2026-10-01T00:00:00.000Z",
});
fs.mkdirSync(accountDir(ACCOUNT_A), { recursive: true });
const workspace = path.join(env.root, "ws");
fs.mkdirSync(workspace);
await store.load();

/** A card in tmux session `dsp-<title>` on `accountId` whose pane shows `pane`. */
async function sessionCard(title: string, accountId: string, pane: string) {
  const created = await store.createLocalCard(DEFAULT_BOARD_KEY, title, "");
  await store.completeStart(created.id, undefined, {
    workspacePath: workspace,
    tmuxSession: `dsp-${title}`,
    branch: title,
    claudeAccountId: accountId,
  });
  fs.writeFileSync(path.join(fake.state, `pane.dsp-${title}`), pane);
  return created.id;
}

/** Fill the active (Default) account's usage cache from a loopback server that answers `body`. */
async function seedDefaultUsage(body: unknown): Promise<void> {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  process.env.DISPATCH_USAGE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/usage`;
  try {
    await refreshUsage("default");
  } finally {
    process.env.DISPATCH_USAGE_URL = DEAD_USAGE_URL;
    server.close();
  }
}

const limitOnA = await sessionCard("ca-limit-a", ACCOUNT_A, LIMIT_PANE);
const limitOnActive = await sessionCard("ca-limit-d", "default", LIMIT_PANE);
const idleOnA = await sessionCard(
  "ca-idle-a",
  ACCOUNT_A,
  "> \n? for shortcuts\n",
);
const busyOnA = await sessionCard("ca-busy-a", ACCOUNT_A, BUSY_PANE);

/** The continue action of each test card, keyed by card id. */
async function actions(): Promise<Record<string, string | undefined>> {
  const out: Record<string, string | undefined> = {};
  for (const e of await listAccountSessions()) out[e.cardId] = e.continueAction;
  return out;
}

void test("no usage snapshot on the active account flags a limit session on another account as usage-unknown", async () => {
  forgetUsage("default");
  const got = await actions();
  assert.equal(got[limitOnA], "usage-unknown");
  assert.equal(got[limitOnActive], undefined, "already on the active account");
  assert.equal(got[idleOnA], undefined, "not at a limit");
  assert.equal(got[busyOnA], undefined, "not at a limit");
  const entry = (await listAccountSessions()).find((e) => e.cardId === idleOnA);
  assert.equal(entry !== undefined && "continueAction" in entry, false);
});

void test("every bucket of the active account below 100 gives available", async () => {
  await seedDefaultUsage({
    five_hour: { utilization: 40, resets_at: null },
    seven_day: { utilization: 99, resets_at: null },
  });
  const got = await actions();
  assert.equal(got[limitOnA], "available");
  assert.equal(got[limitOnActive], undefined);
  assert.equal(got[idleOnA], undefined);
});

void test("any bucket of the active account at 100 leaves the action out", async () => {
  await seedDefaultUsage({
    five_hour: { utilization: 10, resets_at: null },
    seven_day: { utilization: 100, resets_at: null },
  });
  const got = await actions();
  assert.equal(got[limitOnA], undefined);
  assert.equal(got[limitOnActive], undefined);
});

void test.after(() => env.cleanup());
