import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import type {
  AccountEventType,
  ActivityEvent,
  Card,
} from "../../src/shared/types.js";
import { makeSampleRepo } from "./fixtures/scenario-1/repo.js";
import { readyRows } from "./fixtures/scenario-1/status-rows.js";
import { cardOf, writeRunLog } from "./harness/board-reads.js";
import {
  EVIDENCE_DIR,
  MINUTE,
  SANDBOX_ROOT,
  makeNote,
  startSandbox,
  waitFor,
  type Sandbox,
} from "./harness/sandbox.js";

const BOARD = "LAM";
const EVENT_BOARD = "LOCAL";
const CARD = "LAM-1";
const ORCHESTRATOR_CARD = "LAM-2";
const CLAUDE_SESSION = "7d3e9f10-2b4c-4a5d-8e6f-0a1b2c3d4e5f";
const LOOP_REPLY = "Still running on the managed account.";

const SANDBOX_NAME = "local-159-managed-default";
const HOME_IDENTITY_FILE = path.join(
  SANDBOX_ROOT,
  SANDBOX_NAME,
  "home-identity.json",
);

const note = makeNote("local-159-managed-default");

interface Reply<T = Record<string, unknown>> {
  status: number;
  body: T;
}

type AccountEventRow = Omit<ActivityEvent, "type"> & {
  type: AccountEventType | ActivityEvent["type"];
};

interface SessionRow {
  cardId: string;
  id: string;
  claudeAccountId?: string;
  claudeAccountStale?: boolean;
}

interface AccountRow {
  id: string;
  managedDefault?: boolean;
}

interface AccountsView {
  accounts: AccountRow[];
  activeId: string;
  managedDefaultOffer: boolean;
}

interface LoginView {
  state: string;
  message?: string;
  account?: { id: string; managedDefault?: boolean };
}

const HOME = {
  loggedIn: true,
  email: "home@example.com",
  orgId: "org-home",
  orgName: "Home Org",
  subscriptionType: "max",
};

const OTHER = {
  ...HOME,
  email: "other@example.com",
  orgId: "org-other",
  orgName: "Other Org",
};

/** Write the home identity the fake `claude auth` reads, which the fake login also copies into a new config dir. */
function writeHomeIdentity(identity: typeof HOME): void {
  fs.writeFileSync(HOME_IDENTITY_FILE, JSON.stringify(identity));
}

async function postHook(
  sb: Sandbox,
  session: string,
  body: Record<string, unknown>,
): Promise<void> {
  const line = sb.tmux([
    "show-environment",
    "-t",
    `=${session}`,
    "DISPATCH_HOOK_TOKEN",
  ]);
  const token = line.trim().replace(/^DISPATCH_HOOK_TOKEN=/, "");
  assert.notEqual(token, "", "the session carries a hook token");
  const res = await fetch(`${sb.url}/api/hook/claude`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-dispatch-token": token },
    body: JSON.stringify(body),
  });
  assert.equal(res.status, 204);
}

async function orch<T = Record<string, unknown>>(
  sb: Sandbox,
  token: string,
  method: string,
  route: string,
  body?: unknown,
): Promise<Reply<T>> {
  const res = await fetch(`${sb.url}/api/orchestrator${route}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-orchestrator-token": token,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  return {
    status: res.status,
    body: (text === "" ? {} : JSON.parse(text)) as T,
  };
}

async function setupBoard(sb: Sandbox): Promise<void> {
  const sample = makeSampleRepo(sb.root, sb.home);
  const sessions = path.join(sb.workspaces, "lam-sessions");
  fs.mkdirSync(sessions, { recursive: true });
  const board = await sb.api("POST", "/api/boards", {
    key: BOARD,
    name: "Managed default board",
    workspaceRoot: sessions,
    repositories: [
      { path: sample.repo, baseBranch: "main", checkCommand: "true" },
    ],
  });
  assert.equal(board.status, 201);
  const policy = await sb.api("PUT", `/api/boards/${BOARD}/policy`, {
    roadmapApproval: "all",
    concurrencyCap: 3,
    loopModel: "claude-sonnet-5-5:high",
    orchestratorModel: "claude-sonnet-5-5",
    handoffPercent: 50,
    handoffHardPercent: 80,
    usageLimit: "wait",
    shipRights: "merge",
    budgetPerGroup: null,
    supervisor: "on",
    groupPlaybook: null,
  });
  assert.equal(policy.status, 200);
  const made = await sb.api<{ id: string }>(
    "POST",
    `/api/cards?board=${BOARD}`,
    {
      title: "Add the export button",
      description: "One feature of one module.",
    },
  );
  assert.equal(made.status, 201);
  assert.equal(made.body.id, CARD);
  const added = await sb.api("POST", `/api/boards/${BOARD}/orchestrators`, {
    id: "main",
    name: "Main",
    role: "main",
  });
  assert.equal(added.status, 201);
}

/**
 * Write the replay files of both cards and return the transcript paths they append to.
 *
 * @remarks The loop card answers every prompt with one normal reply and never stops at a limit.
 */
function writeScenarios(sb: Sandbox): { orchestrator: string; loop: string } {
  const loopDir = path.join(sb.home, ".claude", "projects", "lam");
  fs.mkdirSync(loopDir, { recursive: true });
  const loop = path.join(loopDir, `${CLAUDE_SESSION}.jsonl`);
  const orchestrator = path.join(sb.logs, "orchestrator.jsonl");
  fs.writeFileSync(loop, "");
  fs.writeFileSync(orchestrator, "");
  fs.writeFileSync(
    path.join(sb.scenarios, `${CARD}.json`),
    JSON.stringify({
      statusRows: readyRows(),
      reply: LOOP_REPLY,
      transcriptPath: loop,
      exitOnExit: true,
    }),
  );
  fs.writeFileSync(
    path.join(sb.scenarios, `${ORCHESTRATOR_CARD}.json`),
    JSON.stringify({
      statusRows: readyRows(),
      reply: "ok",
      transcriptPath: orchestrator,
    }),
  );
  return { orchestrator, loop };
}

async function startOrchestrator(
  sb: Sandbox,
  transcript: string,
): Promise<string> {
  const start = await sb.api(
    "POST",
    `/api/boards/${BOARD}/orchestrators/main/start`,
  );
  assert.equal(start.status, 202);
  const session = await waitFor(
    () =>
      sb
        .tmux(["list-sessions", "-F", "#{session_name}"])
        .split("\n")
        .filter((n) => n !== "")
        .find(
          (n) =>
            sb
              .tmux(["show-environment", "-t", `=${n}`, "DISPATCH_CARD_ID"])
              .trim() === `DISPATCH_CARD_ID=${ORCHESTRATOR_CARD}`,
        ),
    MINUTE,
    "the tmux session of the orchestrator card",
  );
  await postHook(sb, session, {
    hook_event_name: "SessionStart",
    session_id: "orchestrator",
    transcript_path: transcript,
  });
  const minted = await sb.api<{ token: string }>(
    "POST",
    `/api/boards/${BOARD}/orchestrators/main/token`,
  );
  assert.equal(minted.status, 201);
  note("orchestrator started");
  return minted.body.token;
}

async function startLoop(sb: Sandbox, token: string): Promise<Card> {
  const started = await orch(sb, token, "POST", `/cards/${CARD}/start`, {
    playbook: "PRD + Ralph Loop",
    direction: "Build it.",
  });
  assert.equal(started.status, 202, JSON.stringify(started.body));
  return waitFor(
    async () => {
      const read = await cardOf(sb, BOARD, CARD);
      return read?.tmuxSession !== undefined ? read : null;
    },
    4 * MINUTE,
    `the session of ${CARD}`,
  );
}

const sessionRow = async (
  sb: Sandbox,
  token: string,
): Promise<SessionRow | undefined> =>
  (
    await orch<{ sessions: SessionRow[] }>(sb, token, "GET", "/sessions")
  ).body.sessions?.find((s) => s.cardId === CARD);

const accountsView = async (sb: Sandbox): Promise<AccountsView> =>
  (await sb.api<AccountsView>("GET", "/api/accounts")).body;

const loginView = async (sb: Sandbox): Promise<LoginView> =>
  (await sb.api<LoginView>("GET", "/api/accounts/login")).body;

async function waitForLoginState(
  sb: Sandbox,
  state: string,
): Promise<LoginView> {
  return waitFor(
    async () => {
      const view = await loginView(sb);
      if (view.state === "error") {
        throw new Error(`the login view reads error: ${view.message}`);
      }
      return view.state === state ? view : null;
    },
    MINUTE,
    `the login view to reach ${state}`,
    { pollMs: 500 },
  );
}

/** Move the home login under a managed account through the fake `claude auth login` and return its id. */
async function loginManagedDefault(sb: Sandbox): Promise<string> {
  const started = await sb.api("POST", "/api/accounts/login", {
    managedDefault: true,
  });
  assert.equal(started.status, 202, JSON.stringify(started.body));
  await waitForLoginState(sb, "awaiting-code");
  const code = await sb.api("POST", "/api/accounts/login/code", {
    code: "home",
  });
  assert.equal(code.status, 200, JSON.stringify(code.body));
  const done = await waitForLoginState(sb, "done");
  const id = done.account?.id ?? "";
  assert.notEqual(id, "", JSON.stringify(done));
  return id;
}

/** Check the loop session row and its tmux environment both name the managed account. */
async function assertLoopOnManaged(
  sb: Sandbox,
  token: string,
  tmuxSession: string,
  managedId: string,
): Promise<void> {
  const row = await sessionRow(sb, token);
  assert.equal(row?.claudeAccountId, managedId);
  const env = sb
    .tmux(["show-environment", "-t", `=${tmuxSession}`, "CLAUDE_CONFIG_DIR"])
    .trim();
  assert.equal(
    env,
    `CLAUDE_CONFIG_DIR=${path.join(sb.dir, "claude-accounts", managedId)}`,
  );
}

const loginChangedEvents = async (sb: Sandbox): Promise<AccountEventRow[]> =>
  (
    await sb.api<{ events: AccountEventRow[] }>(
      "GET",
      `/api/events?board=${EVENT_BOARD}&limit=1000`,
    )
  ).body.events.filter(
    (e) => e.type === "account_login_changed" && e.source === "accounts",
  );

/**
 * Refresh the Default usage until the identity check has recorded an `account_login_changed` event.
 *
 * @remarks A 429 `too-soon` reply means a manual refresh ran lately, so the next poll tries again.
 */
async function waitForLoginChanged(sb: Sandbox): Promise<AccountEventRow> {
  return waitFor(
    async () => {
      await sb.api("POST", "/api/accounts/default/usage/refresh");
      return (await loginChangedEvents(sb))[0] ?? null;
    },
    3 * MINUTE,
    "an account_login_changed event",
    { pollMs: 5000 },
  );
}

/**
 * Run a loop on the managed default, change the home login, and check the loop stays on the managed account.
 *
 * @remarks The first refresh stores the home identity, because the check only reports a change against a stored one.
 */
async function runManagedDefault(sb: Sandbox): Promise<void> {
  const before = await accountsView(sb);
  assert.equal(before.managedDefaultOffer, true);
  assert.ok(before.accounts.some((a) => a.id === "default"));
  await sb.api("POST", "/api/accounts/default/usage/refresh");
  note("home identity stored, the managed default is offered");

  const managedId = await loginManagedDefault(sb);
  const after = await accountsView(sb);
  assert.equal(after.managedDefaultOffer, false);
  assert.ok(!after.accounts.some((a) => a.id === "default"));
  assert.equal(
    after.accounts.find((a) => a.id === managedId)?.managedDefault,
    true,
  );
  assert.equal(after.activeId, managedId);
  note(`managed default ${managedId} is active`);

  await setupBoard(sb);
  const transcripts = writeScenarios(sb);
  const token = await startOrchestrator(sb, transcripts.orchestrator);
  const card = await startLoop(sb, token);
  const tmuxSession = card.tmuxSession ?? "";
  await postHook(sb, tmuxSession, {
    hook_event_name: "SessionStart",
    session_id: CLAUDE_SESSION,
    transcript_path: transcripts.loop,
  });
  await assertLoopOnManaged(sb, token, tmuxSession, managedId);
  note("the loop runs on the managed account with its config dir");

  writeHomeIdentity(OTHER);
  const changed = await waitForLoginChanged(sb);
  note(`event recorded: ${changed.reason}`);

  const row = await sessionRow(sb, token);
  assert.equal(row?.claudeAccountId, managedId);
  assert.notEqual(row?.claudeAccountStale, true);
  const final = await accountsView(sb);
  assert.ok(!final.accounts.some((a) => a.id === "default"));
  note("the loop stays on the managed account after the home login changed");
}

async function finish(sb: Sandbox, runLog: string): Promise<void> {
  try {
    await writeRunLog(sb, BOARD, runLog);
  } catch (err) {
    note(
      `run log not written: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  await sb.stop();
}

void test(
  "scenario-LOCAL-159-managed-default: a managed default keeps its loop when the home login changes",
  { timeout: 10 * MINUTE },
  async () => {
    const sb = await startSandbox({
      name: SANDBOX_NAME,
      seed: () => {
        writeHomeIdentity(HOME);
      },
      env: { FAKE_CLAUDE_IDENTITY_FILE: HOME_IDENTITY_FILE },
    });
    try {
      await runManagedDefault(sb);
    } finally {
      await finish(
        sb,
        path.join(
          EVIDENCE_DIR,
          "local-159-managed-default-managed-default-run-log.txt",
        ),
      );
    }
  },
);
