import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { isolateEnv } from "../../test-support/fixtures.js";

const env = isolateEnv();
const paths = await import("../infra/paths.js");
const configHolder = await import("../infra/config-holder.js");
const accounts = await import("./claude-accounts.js");

configHolder.setOrchestrationConfig({ linearApiKey: "", port: 4700 });

const ID_A = "11111111-1111-4111-8111-111111111111";
const ID_B = "22222222-2222-4222-8222-222222222222";
const HOME_IDENTITY = {
  loggedIn: true,
  email: "home@example.com",
  orgId: "org-home",
  orgName: "Home Org",
  subscriptionType: "max",
};

function seedRegistry(ids: string[]): void {
  fs.mkdirSync(paths.CLAUDE_ACCOUNTS_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(
    paths.CLAUDE_ACCOUNTS_REGISTRY_PATH,
    JSON.stringify({
      version: 1,
      accounts: ids.map((id) => record(id, `${id.slice(0, 8)}@example.com`)),
    }),
    { mode: 0o600 },
  );
}

function readConfig(): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(env.dispatchDir, "config.json"), "utf8"),
  ) as Record<string, unknown>;
}

function record(id: string, email: string) {
  return {
    id,
    email,
    orgId: "org-x",
    orgName: "Org X",
    subscriptionType: "pro",
    createdAt: "2026-09-02T00:00:00.000Z",
    lastLoginAt: "2026-09-02T00:00:00.000Z",
  };
}

void test("isBlocklisted keeps credentials and state out, shares everything else", () => {
  for (const name of [
    ".claude.json",
    ".claude.json.lock",
    ".claude.json.backup.2026",
    ".credentials.json",
    "statsig",
    "history.jsonl",
    "session-env",
  ]) {
    assert.equal(accounts.isBlocklisted(name), true, name);
  }
  for (const name of [
    "settings.json",
    "skills",
    "agents",
    "plugins",
    "projects",
    "CLAUDE.md",
  ]) {
    assert.equal(accounts.isBlocklisted(name), false, name);
  }
});

void test("planLinks truth table", () => {
  const home = "/h/.claude";
  const ops = accounts.planLinks(
    [
      "settings.json",
      "skills",
      ".credentials.json",
      "projects",
      "agents",
      "statsig",
    ],
    {
      "settings.json": { kind: "symlink", target: "/h/.claude/settings.json" },
      skills: { kind: "symlink", target: "/elsewhere/skills" },
      projects: { kind: "dir" },
      agents: { kind: "file" },
    },
    home,
  );
  assert.deepEqual(ops, [
    { name: "settings.json", action: "keep" },
    { name: "skills", action: "replace" },
    { name: "projects", action: "replace" },
    { name: "agents", action: "replace" },
  ]);
});

void test("isAccountId accepts only lowercase uuids", () => {
  assert.equal(accounts.isAccountId(ID_A), true);
  assert.equal(accounts.isAccountId("default"), false);
  assert.equal(accounts.isAccountId("../etc"), false);
  assert.equal(
    accounts.isAccountId("AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA"),
    false,
  );
  assert.equal(
    accounts.isAccountId("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
    true,
  );
  assert.throws(() => accounts.accountDir("../x"));
});

void test("keychainServiceName is bare for the home login and sha8-suffixed for a config dir", () => {
  assert.equal(accounts.keychainServiceName(), "Claude Code-credentials");
  const scoped = accounts.keychainServiceName("/some/dir");
  assert.match(scoped, /^Claude Code-credentials-[0-9a-f]{8}$/);
  assert.equal(scoped, accounts.keychainServiceName("/some/dir"));
  assert.notEqual(scoped, accounts.keychainServiceName("/other/dir"));
});

void test("materializeConfigDir links home entries, skips the blocklist, seeds .claude.json, self-heals", async () => {
  const dir = await accounts.materializeConfigDir(ID_A);
  assert.equal(dir, path.join(paths.CLAUDE_ACCOUNTS_DIR, ID_A));
  assert.equal((fs.statSync(dir).mode & 0o777).toString(8), "700");
  for (const name of ["settings.json", "skills", "projects"]) {
    const link = path.join(dir, name);
    assert.equal(fs.lstatSync(link).isSymbolicLink(), true, name);
    assert.equal(fs.readlinkSync(link), path.join(paths.CLAUDE_HOME_DIR, name));
  }
  for (const name of ["statsig", "history.jsonl", ".credentials.json"]) {
    assert.equal(fs.existsSync(path.join(dir, name)), false, name);
  }
  const seeded = JSON.parse(
    fs.readFileSync(path.join(dir, ".claude.json"), "utf8"),
  ) as Record<string, unknown>;
  assert.equal(seeded.hasCompletedOnboarding, true);
  assert.equal("oauthAccount" in seeded, false);
  assert.equal(
    (fs.statSync(path.join(dir, ".claude.json")).mode & 0o777).toString(8),
    "600",
  );

  fs.unlinkSync(path.join(dir, "settings.json"));
  fs.writeFileSync(path.join(dir, "settings.json"), '{"drift":true}');
  fs.writeFileSync(path.join(dir, ".claude.json"), '{"kept":true}');
  await accounts.materializeConfigDir(ID_A);
  assert.equal(
    fs.lstatSync(path.join(dir, "settings.json")).isSymbolicLink(),
    true,
  );
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(dir, ".claude.json"), "utf8")),
    {
      kept: true,
    },
  );
});

void test("registry round-trips at 0600 inside 0700 and fails closed on garbage", async () => {
  assert.deepEqual(await accounts.readRegistry(), []);
  await accounts.upsertAccount(record(ID_A, "a@example.com"));
  await accounts.upsertAccount(record(ID_B, "b@example.com"));
  await accounts.upsertAccount({ ...record(ID_A, "a2@example.com") });
  const list = await accounts.readRegistry();
  assert.deepEqual(list.map((a) => [a.id, a.email]).sort(), [
    [ID_A, "a2@example.com"],
    [ID_B, "b@example.com"],
  ]);
  assert.equal(
    (fs.statSync(paths.CLAUDE_ACCOUNTS_REGISTRY_PATH).mode & 0o777).toString(8),
    "600",
  );
  assert.equal(
    (fs.statSync(paths.CLAUDE_ACCOUNTS_DIR).mode & 0o777).toString(8),
    "700",
  );
  const raw = fs.readFileSync(paths.CLAUDE_ACCOUNTS_REGISTRY_PATH, "utf8");
  assert.doesNotMatch(raw, /accessToken|refreshToken|sk-ant-/);

  fs.writeFileSync(
    paths.CLAUDE_ACCOUNTS_REGISTRY_PATH,
    '{"accounts":[{"nope":1}]}',
  );
  await assert.rejects(accounts.readRegistry(), /malformed/);
  fs.writeFileSync(paths.CLAUDE_ACCOUNTS_REGISTRY_PATH, "not json");
  await assert.rejects(accounts.readRegistry());
  fs.writeFileSync(
    paths.CLAUDE_ACCOUNTS_REGISTRY_PATH,
    '{"accounts":[{"id":"11111111-1111-4111-8111-111111111111","email":"x"}]}',
  );
  await assert.rejects(accounts.readRegistry(), /malformed/);
});

void test("setActiveAccount rejects unknown ids and leaves config untouched", async () => {
  seedRegistry([ID_A, ID_B]);
  const configPath = path.join(env.dispatchDir, "config.json");
  const before = fs.readFileSync(configPath, "utf8");
  const missing = "33333333-3333-4333-8333-333333333333";
  assert.deepEqual(await accounts.setActiveAccount(missing), {
    ok: false,
    error: "not-found",
  });
  assert.deepEqual(await accounts.setActiveAccount("bogus"), {
    ok: false,
    error: "not-found",
  });
  assert.equal(fs.readFileSync(configPath, "utf8"), before);
  assert.equal(accounts.getActiveAccountId(), "default");

  assert.deepEqual(await accounts.setActiveAccount(ID_A), { ok: true });
  assert.equal(accounts.getActiveAccountId(), ID_A);
  assert.equal(readConfig().activeClaudeAccountId, ID_A);

  assert.deepEqual(await accounts.setActiveAccount("default"), { ok: true });
  assert.equal("activeClaudeAccountId" in readConfig(), false);
});

void test("removeAccount deletes the dir, drops the record, and resets an active pointer", async () => {
  seedRegistry([ID_A, ID_B]);
  await accounts.materializeConfigDir(ID_A);
  const dir = accounts.accountDir(ID_A);
  await accounts.setActiveAccount(ID_A);
  assert.deepEqual(await accounts.removeAccount(ID_A), { ok: true });
  assert.equal(fs.existsSync(dir), false);
  assert.equal(accounts.getActiveAccountId(), "default");
  assert.deepEqual(
    (await accounts.readRegistry()).map((a) => a.id),
    [ID_B],
  );
  assert.deepEqual(await accounts.removeAccount(ID_A), {
    ok: false,
    error: "not-found",
  });
});

void test("listAccounts puts the home login first with the given identity", async () => {
  seedRegistry([ID_B]);
  const list = await accounts.listAccounts(HOME_IDENTITY);
  assert.equal(list[0].id, "default");
  assert.equal(list[0].isDefault, true);
  assert.equal(list[0].email, "home@example.com");
  assert.equal(list[0].subscriptionType, "max");
  assert.deepEqual(
    list.slice(1).map((a) => a.id),
    [ID_B],
  );
  assert.equal(list[1].isDefault, false);
});

void test("resolveLaunchAccount: default passes no dir, a registered account with a dir passes it, a dangling pointer throws", async () => {
  seedRegistry([ID_B]);
  assert.deepEqual(await accounts.resolveLaunchAccount("default"), {
    id: "default",
  });
  await accounts.materializeConfigDir(ID_B);
  const resolved = await accounts.resolveLaunchAccount(ID_B);
  assert.equal(resolved.configDir, accounts.accountDir(ID_B));

  fs.rmSync(accounts.accountDir(ID_B), { recursive: true, force: true });
  await assert.rejects(
    accounts.resolveLaunchAccount(ID_B),
    /no config directory/,
  );
  await assert.rejects(
    accounts.resolveLaunchAccount("33333333-3333-4333-8333-333333333333"),
    /no longer registered/,
  );
  await assert.rejects(accounts.resolveLaunchAccount("../x"), /not a valid/);
});

void test.after(() => env.cleanup());

void test("materializeConfigDir tolerates two concurrent calls for the same account", async () => {
  seedRegistry([ID_B]);
  fs.rmSync(accounts.accountDir(ID_B), { recursive: true, force: true });
  const [a, b] = await Promise.all([
    accounts.materializeConfigDir(ID_B),
    accounts.materializeConfigDir(ID_B),
  ]);
  assert.equal(a, b);
  assert.equal(
    fs.lstatSync(path.join(a, "settings.json")).isSymbolicLink(),
    true,
  );
  const [launch, removed] = await Promise.all([
    accounts.resolveLaunchAccount(ID_B),
    accounts.removeAccount(ID_B),
  ]);
  assert.equal(launch.configDir, accounts.accountDir(ID_B));
  assert.deepEqual(removed, { ok: true });
  assert.equal(fs.existsSync(accounts.accountDir(ID_B)), false);
  seedRegistry([ID_B]);
  await assert.rejects(
    Promise.all([
      accounts.removeAccount(ID_B),
      accounts.resolveLaunchAccount(ID_B),
    ]),
    /no longer registered/,
  );
});
