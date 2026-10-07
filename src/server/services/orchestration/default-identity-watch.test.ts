import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { isolateEnv } from "../../test-support/fixtures.js";
import type { ClaudeIdentity } from "../../adapters/claude-cli.js";
import { DEFAULT_BOARD_KEY } from "../../../shared/board-key.js";

const env = isolateEnv();
const identityFile = path.join(env.root, "home-identity.json");
process.env.FAKE_CLAUDE_IDENTITY_FILE = identityFile;

const { store } = await import("../../store/board.store.js");
const accounts = await import("./claude-accounts.js");
const ops = await import("./claude-account-ops.js");
const watch = await import("./default-identity-watch.js");
await store.load();

const ACCOUNT_A = "11111111-1111-4111-8111-111111111111";
const workspace = path.join(env.root, "ws");
fs.mkdirSync(workspace);

function read(over: Partial<ClaudeIdentity> = {}): ClaudeIdentity {
  return {
    loggedIn: true,
    email: "a@example.com",
    orgId: "org-1",
    orgName: "Org",
    subscriptionType: "max",
    ...over,
  };
}

function setHome(identity: ClaudeIdentity | string): void {
  fs.writeFileSync(
    identityFile,
    typeof identity === "string" ? identity : JSON.stringify(identity),
  );
}

const changedEvents = () =>
  store
    .listEvents(DEFAULT_BOARD_KEY, null, 100)
    .filter((e) => (e.type as string) === "account_login_changed");

async function sessionCard(title: string, accountId?: string) {
  const created = await store.createLocalCard(DEFAULT_BOARD_KEY, title, "");
  await store.completeStart(created.id, undefined, {
    workspacePath: workspace,
    tmuxSession: `dsp-${title}`,
    branch: title,
    ...(accountId ? { claudeAccountId: accountId } : {}),
  });
  return {
    cardId: created.id,
    sessionId: store.getCard(created.id)!.activeSessionId!,
  };
}

const staleOf = (r: { cardId: string; sessionId: string }) =>
  store.getCard(r.cardId)?.sessions?.find((s) => s.id === r.sessionId)
    ?.claudeAccountStale === true;

void test("compareIdentity truth table", () => {
  const stored = { email: "a@example.com", orgId: "org-1" };
  const { compareIdentity } = watch;
  assert.equal(compareIdentity(undefined, read()), "store-first");
  assert.equal(compareIdentity(stored, read()), "same");
  assert.equal(
    compareIdentity(stored, read({ email: "b@example.com" })),
    "changed",
  );
  assert.equal(compareIdentity(stored, read({ orgId: "org-2" })), "changed");
  assert.equal(compareIdentity(stored, read({ orgId: "" })), "same");
  assert.equal(
    compareIdentity(stored, read({ email: "b@example.com", orgId: "" })),
    "changed",
  );
  const out = read({ loggedIn: false, email: "", orgId: "" });
  assert.equal(compareIdentity(stored, out), "ignore");
  assert.equal(compareIdentity(undefined, out), "ignore");
});

void test("first read stores and emits nothing, a repeat read emits nothing", async () => {
  setHome(read());
  await watch.checkDefaultIdentity();
  assert.deepEqual(await accounts.readDefaultIdentity(), {
    email: "a@example.com",
    orgId: "org-1",
  });
  assert.equal(changedEvents().length, 0);
  await watch.checkDefaultIdentity();
  assert.equal(changedEvents().length, 0);
});

void test("a change marks exactly the live Default sessions and emits once", async () => {
  const d1 = await sessionCard("w-d1");
  const d2 = await sessionCard("w-d2", "default");
  const added = await sessionCard("w-added", ACCOUNT_A);
  const lost = await sessionCard("w-lost");
  await store.markSessionLost(lost.cardId, lost.sessionId);

  assert.equal((await ops.listAccountSummaries())[0]?.email, "a@example.com");
  setHome(read({ email: "b@example.com" }));
  await Promise.all([
    watch.checkDefaultIdentity(),
    watch.checkDefaultIdentity(),
  ]);

  assert.equal(staleOf(d1), true);
  assert.equal(staleOf(d2), true);
  assert.equal(staleOf(added), false);
  assert.equal(staleOf(lost), false);
  const events = changedEvents();
  assert.equal(events.length, 1);
  assert.match(events[0]?.reason ?? "", /a@example\.com.*b@example\.com/);
  assert.deepEqual(await accounts.readDefaultIdentity(), {
    email: "b@example.com",
    orgId: "org-1",
  });
  assert.equal(
    (await ops.listAccountSummaries())[0]?.email,
    "b@example.com",
    "the listing shows the new email at once",
  );

  await watch.checkDefaultIdentity();
  assert.equal(changedEvents().length, 1);

  const after = await sessionCard("w-after");
  assert.equal(
    staleOf(after),
    false,
    "a session started after the change is not stale",
  );
});

void test("an organisation change counts as a change", async () => {
  const s = await sessionCard("w-org");
  setHome(read({ email: "b@example.com", orgId: "org-9" }));
  await watch.checkDefaultIdentity();
  assert.equal(staleOf(s), true);
  assert.equal(changedEvents().length, 2);
});

void test("a logged out or failed read marks nothing and emits nothing", async () => {
  const s = await sessionCard("w-out");
  const eventsBefore = changedEvents().length;
  const identityBefore = await accounts.readDefaultIdentity();
  setHome(read({ loggedIn: false, email: "", orgId: "" }));
  await watch.checkDefaultIdentity();
  setHome("not json");
  await watch.checkDefaultIdentity();
  assert.equal(staleOf(s), false);
  assert.equal(changedEvents().length, eventsBefore);
  assert.deepEqual(await accounts.readDefaultIdentity(), identityBefore);
});

void test("the watch timer checks and stops", async () => {
  const s = await sessionCard("w-timer");
  setHome(read({ email: "c@example.com", orgId: "org-9" }));
  const stop = watch.startDefaultIdentityWatch(20);
  for (let i = 0; i < 100 && !staleOf(s); i++) {
    await new Promise((r) => setTimeout(r, 20));
  }
  stop();
  assert.equal(staleOf(s), true);
});
