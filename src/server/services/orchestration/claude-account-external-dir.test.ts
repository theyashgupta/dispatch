import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { isolateEnv } from "../../test-support/fixtures.js";
import { installFakeTmux } from "../../test-support/fake-tmux.js";
import { DEFAULT_BOARD_KEY } from "../../../shared/board-key.js";

const env = isolateEnv();
const fake = installFakeTmux(env);

const paths = await import("../infra/paths.js");
const { setHooksRuntime } = await import("../infra/config-holder.js");
const accounts = await import("./claude-accounts.js");
const { startLogin } = await import("./claude-login.js");
const { removeAccountAndLogout } = await import("./claude-account-ops.js");
const { launchClaude } = await import("./steps.js");
const { moveSessionAccount } = await import("./session-account-move.js");
const { store } = await import("../../store/board.store.js");
setHooksRuntime({ capable: true, port: 1, statusChannel: "auto" });

const EXTERNAL_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_ID = "44444444-4444-4444-8444-444444444444";
const externalDir = path.join(env.root, "elsewhere", "account");
const workspace = path.join(env.root, "ws");
const previousOverride = process.env.DISPATCH_ACCOUNT_DIRS;

fs.mkdirSync(path.join(externalDir, "projects"), { recursive: true });
fs.writeFileSync(path.join(externalDir, ".claude.json"), "{}\n");
fs.writeFileSync(
  path.join(externalDir, ".fake-login"),
  '{"loggedIn":true,"email":"ext@example.com","orgId":"org-ext","orgName":"Ext","subscriptionType":"max"}\n',
);
fs.symlinkSync(
  path.join(env.home, ".claude", "settings.json"),
  path.join(externalDir, "settings.json"),
);
fs.mkdirSync(workspace);
process.env.DISPATCH_ACCOUNT_DIRS = `${EXTERNAL_ID}=${externalDir}`;

for (const id of [EXTERNAL_ID, OTHER_ID]) {
  await accounts.upsertAccount({
    id,
    email: `${id.slice(0, 4)}@example.com`,
    orgId: "org",
    orgName: "Org",
    subscriptionType: "max",
    createdAt: "2026-10-01T00:00:00.000Z",
    lastLoginAt: "2026-10-01T00:00:00.000Z",
  });
}
fs.mkdirSync(accounts.accountDir(OTHER_ID), { recursive: true });
await store.load();

/**
 * Describe every entry under a dir by relative path: file bytes, link target or dir mode.
 */
function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (rel: string): void => {
    const abs = path.join(dir, rel);
    const st = fs.lstatSync(abs);
    if (st.isSymbolicLink()) out[rel] = `link ${fs.readlinkSync(abs)}`;
    else if (st.isFile()) {
      out[rel] = `file ${st.mode} ${fs.readFileSync(abs, "base64")}`;
    } else {
      out[rel] = `dir ${st.mode}`;
      for (const name of fs.readdirSync(abs).sort()) {
        walk(path.join(rel, name));
      }
    }
  };
  walk(".");
  return out;
}

const before = snapshot(externalDir);

/**
 * Run a body with `DISPATCH_ACCOUNT_DIRS` set to a value, then restore the external pair.
 */
function withOverride(value: string, body: () => void): void {
  process.env.DISPATCH_ACCOUNT_DIRS = value;
  try {
    body();
  } finally {
    process.env.DISPATCH_ACCOUNT_DIRS = `${EXTERNAL_ID}=${externalDir}`;
  }
}

void test("accountDir returns the override path for its id only", () => {
  assert.equal(accounts.accountDir(EXTERNAL_ID), externalDir);
  assert.equal(accounts.isExternalAccountDir(EXTERNAL_ID), true);
  assert.equal(accounts.isExternalAccountDir(OTHER_ID), false);
  assert.equal(
    accounts.accountDir(OTHER_ID),
    path.join(paths.CLAUDE_ACCOUNTS_DIR, OTHER_ID),
  );
  withOverride(
    ` ${OTHER_ID} = ${externalDir} ,${EXTERNAL_ID}=${externalDir}`,
    () => {
      assert.equal(
        accounts.accountDir(OTHER_ID),
        externalDir,
        "pairs are trimmed",
      );
      assert.equal(accounts.accountDir(EXTERNAL_ID), externalDir);
    },
  );
});

void test("a malformed pair or a relative path is ignored", () => {
  const inside = path.join(paths.CLAUDE_ACCOUNTS_DIR, EXTERNAL_ID);
  for (const value of [
    "",
    "nonsense",
    EXTERNAL_ID,
    `=${externalDir}`,
    `${EXTERNAL_ID}=`,
    `${EXTERNAL_ID}=relative/dir`,
    `${EXTERNAL_ID}=./account`,
    `not-a-uuid=${externalDir}`,
    `${EXTERNAL_ID}x=${externalDir}`,
    `../etc=${externalDir}`,
  ]) {
    withOverride(value, () => {
      assert.equal(accounts.isExternalAccountDir(EXTERNAL_ID), false, value);
      assert.equal(accounts.accountDir(EXTERNAL_ID), inside, value);
    });
  }
  withOverride(`junk,${OTHER_ID}=rel,${EXTERNAL_ID}=${externalDir}`, () => {
    assert.equal(accounts.accountDir(EXTERNAL_ID), externalDir);
    assert.equal(accounts.isExternalAccountDir(OTHER_ID), false);
  });
  assert.throws(() => accounts.accountDir("../x"));
});

void test("materialize, launch resolve and remove leave the external dir byte-identical", async () => {
  assert.equal(await accounts.materializeConfigDir(EXTERNAL_ID), externalDir);
  assert.deepEqual(await accounts.resolveLaunchAccount(EXTERNAL_ID), {
    id: EXTERNAL_ID,
    configDir: externalDir,
    external: true,
  });
  await accounts.removeConfigDir(EXTERNAL_ID);
  assert.deepEqual(snapshot(externalDir), before);

  assert.deepEqual(await accounts.resolveLaunchAccount(OTHER_ID), {
    id: OTHER_ID,
    configDir: accounts.accountDir(OTHER_ID),
    external: false,
  });
});

void test("re-login and remove refuse the external account and keep its record", async () => {
  assert.deepEqual(await startLogin(EXTERNAL_ID), {
    ok: false,
    error: "not-found",
  });
  assert.deepEqual(await removeAccountAndLogout(EXTERNAL_ID), {
    ok: false,
    error: "not-found",
  });
  assert.equal(
    (await accounts.readRegistry()).some((a) => a.id === EXTERNAL_ID),
    true,
  );
  assert.deepEqual(snapshot(externalDir), before);
});

void test("a launch and a move on the external account do not seed trust into its dir", async () => {
  const created = await store.createLocalCard(
    DEFAULT_BOARD_KEY,
    "ext-move",
    "",
  );
  await store.completeStart(created.id, undefined, {
    workspacePath: workspace,
    tmuxSession: "dsp-ext-move",
    branch: "ext-move",
    claudeAccountId: "default",
  });
  await store.setClaudeSessionId(created.id, undefined, "conv-ext");

  fake.reset();
  assert.equal(await moveSessionAccount(created.id, EXTERNAL_ID), "moved");
  const log = fs.readFileSync(path.join(fake.state, "calls.log"), "utf8");
  assert.match(
    log,
    new RegExp(
      `set-environment\\t-t\\t=dsp-ext-move\\tCLAUDE_CONFIG_DIR\\t${externalDir}`,
    ),
  );
  assert.deepEqual(snapshot(externalDir), before, "the move wrote nothing");

  fake.reset({ "at-prompt": "" });
  await launchClaude({
    cardId: created.id,
    tmuxSession: "dsp-ext-move",
    cwd: workspace,
    leadingArgs: [],
    account: await accounts.resolveLaunchAccount(EXTERNAL_ID),
  });
  assert.deepEqual(snapshot(externalDir), before, "the launch wrote nothing");
});

void test.after(() => {
  if (previousOverride === undefined) delete process.env.DISPATCH_ACCOUNT_DIRS;
  else process.env.DISPATCH_ACCOUNT_DIRS = previousOverride;
  env.cleanup();
});
