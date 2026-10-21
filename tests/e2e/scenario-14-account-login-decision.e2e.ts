import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import test from "node:test";
import type { Card, DecisionItem } from "../../src/shared/types.js";
import { makeSampleRepo } from "./fixtures/scenario-1/repo.js";
import { readyRows } from "./fixtures/scenario-1/status-rows.js";
import { cardOf, writeRunLog } from "./harness/board-reads.js";
import {
  EVIDENCE_DIR,
  MINUTE,
  SANDBOX_ROOT,
  makeNote,
  sleep,
  startSandbox,
  waitFor,
  type Sandbox,
} from "./harness/sandbox.js";

const BOARD = "LAM";
const DECISION_BOARD = "LOCAL";
const CARD = "LAM-1";
const ORCHESTRATOR_CARD = "LAM-2";
const ACCOUNT_A = "a1a1a1a1-0000-4000-8000-00000000000a";
const TOKEN_A = "fake-a";
const EMAIL_A = "fake-a@example.com";
const ORG_A = "org-fake-a";
const CLAUDE_SESSION = "7d3e9f10-2b4c-4a5d-8e6f-0a1b2c3d4e5f";
const LOGIN_CODE = "good";
const LOOP_REPLY = "Still running on the account after the login.";
const USAGE_TIME_SCALE = 20;
const REJECTED_PLAN_MS = 600_000 / USAGE_TIME_SCALE;
const DAY = 24 * 60 * 60 * 1000;

const SANDBOX_NAME = "s14-login-decision";
const LOGIN_IDENTITY_FILE = path.join(
  SANDBOX_ROOT,
  SANDBOX_NAME,
  "login-identity.json",
);
const HOME_IDENTITY_FILE = path.join(
  SANDBOX_ROOT,
  SANDBOX_NAME,
  "home-identity.json",
);

const note = makeNote("scenario-14");

interface Reply<T = Record<string, unknown>> {
  status: number;
  body: T;
}

interface SessionRow {
  cardId: string;
  id: string;
  claudeAccountId?: string;
  claudeAccountStale?: boolean;
}

interface AccountRow {
  id: string;
  state: string;
}

interface LoginView {
  state: string;
  accountId?: string;
  url?: string;
  message?: string;
}

interface TranscriptRow {
  type: string;
  text: string;
}

interface UsageLimit {
  kind: string;
  percent: number;
  resets_at: string;
}

const futureWindow = (kind: string, percent: number): UsageLimit => ({
  kind,
  percent,
  resets_at: new Date(Date.now() + 3 * DAY).toISOString(),
});

interface UsageServer {
  url: string;
  answers: Record<string, UsageLimit[]>;
  close: () => Promise<void>;
}

/**
 * Serve the usage endpoint on an ephemeral loopback port from a mutable answer map, with a 401 for any token the map does not hold.
 *
 * @remarks The Default account token comes from the machine keychain and can reach this server, so the handler reads the
 * authorization header only to pick the answer and never logs or stores a header.
 */
async function startUsageServer(
  answers: Record<string, UsageLimit[]>,
): Promise<UsageServer> {
  const server = http.createServer((req, res) => {
    const token = (req.headers.authorization ?? "").replace(/^Bearer /, "");
    const limits = answers[token];
    res.setHeader("content-type", "application/json");
    if (limits === undefined) {
      res.statusCode = 401;
      res.end("{}");
      return;
    }
    res.end(JSON.stringify({ limits }));
  });
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/api/oauth/usage`,
    answers,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}

/**
 * Write the account registry and the config dir of account A with a fake credentials file into the data folder.
 *
 * @remarks Runs before the server boots, so the first usage read already sees the account.
 */
function seedAccounts(dir: string): void {
  const root = path.join(dir, "claude-accounts");
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const at = "2026-10-01T00:00:00.000Z";
  const configDir = path.join(root, ACCOUNT_A);
  fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(
    path.join(configDir, ".credentials.json"),
    JSON.stringify({ claudeAiOauth: { accessToken: TOKEN_A } }),
    { mode: 0o600 },
  );
  fs.writeFileSync(
    path.join(root, "accounts.json"),
    JSON.stringify({
      version: 2,
      defaultPosition: 0,
      accounts: [
        {
          id: ACCOUNT_A,
          email: EMAIL_A,
          orgId: ORG_A,
          orgName: "Org fake-a",
          subscriptionType: "max",
          createdAt: at,
          lastLoginAt: at,
          position: 1,
        },
      ],
    }),
  );
}

/** Write the two identity files the fake `claude auth` reads into the sandbox root. */
function writeIdentityFiles(): void {
  fs.writeFileSync(
    LOGIN_IDENTITY_FILE,
    JSON.stringify({
      loggedIn: true,
      email: EMAIL_A,
      orgId: ORG_A,
      orgName: "Org fake-a",
      subscriptionType: "max",
    }),
  );
  fs.writeFileSync(
    HOME_IDENTITY_FILE,
    JSON.stringify({
      loggedIn: true,
      email: "home@example.com",
      orgId: "org-home",
      orgName: "Home Org",
      subscriptionType: "max",
    }),
  );
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
    name: "Login decision board",
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

async function startLoopOnAccount(
  sb: Sandbox,
  token: string,
  account: string,
): Promise<Card> {
  const started = await orch(sb, token, "POST", `/cards/${CARD}/start`, {
    playbook: "PRD + Ralph Loop",
    direction: "Build it.",
    account,
  });
  assert.equal(started.status, 202, JSON.stringify(started.body));
  const card = await waitFor(
    async () => {
      const read = await cardOf(sb, BOARD, CARD);
      return read?.tmuxSession !== undefined ? read : null;
    },
    4 * MINUTE,
    `the session of ${CARD}`,
  );
  note(`${CARD} started on ${TOKEN_A}`);
  return card;
}

const readTranscript = (file: string): TranscriptRow[] =>
  fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => {
      const entry = JSON.parse(line) as {
        type: string;
        message: { content: string | { text: string }[] };
      };
      const { content } = entry.message;
      return {
        type: entry.type,
        text: typeof content === "string" ? content : (content[0]?.text ?? ""),
      };
    });

const sessionRow = async (
  sb: Sandbox,
  token: string,
): Promise<SessionRow | undefined> =>
  (
    await orch<{ sessions: SessionRow[] }>(sb, token, "GET", "/sessions")
  ).body.sessions?.find((s) => s.cardId === CARD);

const accountState = async (sb: Sandbox): Promise<string | undefined> =>
  (
    await sb.api<{ accounts: AccountRow[] }>("GET", "/api/accounts")
  ).body.accounts?.find((a) => a.id === ACCOUNT_A)?.state;

const loginView = async (sb: Sandbox): Promise<LoginView> =>
  (await sb.api<LoginView>("GET", "/api/accounts/login")).body;

async function decisionsOf(
  sb: Sandbox,
  state?: "open" | "answered",
): Promise<DecisionItem[]> {
  const query = `board=${DECISION_BOARD}${state ? `&state=${state}` : ""}`;
  const res = await sb.api<{ items: DecisionItem[] }>(
    "GET",
    `/api/decisions?${query}`,
  );
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.items;
}

const namesAccountA = (d: DecisionItem): boolean =>
  d.question.includes(EMAIL_A) || d.question.includes(ACCOUNT_A);

async function finish(
  sb: Sandbox,
  usage: UsageServer,
  runLog: string,
): Promise<void> {
  try {
    await writeRunLog(sb, BOARD, runLog);
  } catch (err) {
    note(
      `run log not written: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  await sb.stop();
  await usage.close();
}

/**
 * Check the loop session runs on account A with that account's config dir in its tmux environment.
 */
async function assertLoopOnAccount(
  sb: Sandbox,
  token: string,
  tmuxSession: string,
): Promise<void> {
  const row = await sessionRow(sb, token);
  assert.equal(row?.claudeAccountId, ACCOUNT_A);
  const env = sb
    .tmux(["show-environment", "-t", `=${tmuxSession}`, "CLAUDE_CONFIG_DIR"])
    .trim();
  assert.equal(
    env,
    `CLAUDE_CONFIG_DIR=${path.join(sb.dir, "claude-accounts", ACCOUNT_A)}`,
  );
}

/**
 * Reject account A twice, answer the login decision, finish the login with code `good`, and check the loop kept running.
 *
 * @remarks The decision must stay single through further rejected reads. The server closes it with `later` only when it is still open, so the user's `login` answer stays.
 */
async function runLoginDecision(
  sb: Sandbox,
  usage: UsageServer,
): Promise<void> {
  await setupBoard(sb);
  const transcripts = writeScenarios(sb);
  const token = await startOrchestrator(sb, transcripts.orchestrator);
  const card = await startLoopOnAccount(sb, token, ACCOUNT_A);
  const tmuxSession = card.tmuxSession ?? "";
  await postHook(sb, tmuxSession, {
    hook_event_name: "SessionStart",
    session_id: CLAUDE_SESSION,
    transcript_path: transcripts.loop,
  });
  await assertLoopOnAccount(sb, token, tmuxSession);
  note("the loop session runs on account A with its config dir");

  await waitFor(
    async () => (await accountState(sb)) === "needs-login",
    4 * MINUTE,
    "account A to read needs-login",
    { pollMs: 1000 },
  );
  note("account A reads needs-login");
  const open = await decisionsOf(sb, "open");
  assert.equal(open.length, 1, JSON.stringify(open));
  assert.equal(open[0].orchestratorId, "dispatch-accounts");
  assert.equal(open[0].kind, "other");
  assert.ok(
    open[0].question.includes(`Account ${EMAIL_A} needs a login`),
    open[0].question,
  );
  assert.ok(open[0].question.includes(`/#/accounts/${ACCOUNT_A}`));
  assert.deepEqual(
    open[0].options.map((o) => o.id),
    ["login", "later"],
  );

  await sleep(3 * REJECTED_PLAN_MS + 5000);
  assert.equal(await accountState(sb), "needs-login");
  const stillOpen = await decisionsOf(sb, "open");
  assert.equal(
    stillOpen.length,
    1,
    `more rejected reads changed the open decisions: ${JSON.stringify(stillOpen)}`,
  );
  assert.equal(stillOpen[0].id, open[0].id);
  note("two more planned reads left one open decision");

  const answered = await sb.api("POST", `/api/decisions/${open[0].id}/answer`, {
    optionId: "login",
  });
  assert.equal(answered.status, 200, JSON.stringify(answered.body));
  const awaiting = await waitFor(
    async () => {
      const view = await loginView(sb);
      return view.state === "awaiting-code" ? view : null;
    },
    MINUTE,
    "the login view to reach awaiting-code",
    { pollMs: 500 },
  );
  assert.equal(awaiting.accountId, ACCOUNT_A);
  note(`login view awaits the code at ${awaiting.url}`);

  usage.answers[TOKEN_A] = [
    futureWindow("weekly_all", 13),
    futureWindow("session", 7),
  ];
  const code = await sb.api("POST", "/api/accounts/login/code", {
    code: LOGIN_CODE,
  });
  assert.equal(code.status, 200, JSON.stringify(code.body));
  const done = await waitFor(
    async () => {
      const view = await loginView(sb);
      if (view.state === "error") {
        throw new Error(`the login view reads error: ${view.message}`);
      }
      return view.state === "done" ? view : null;
    },
    MINUTE,
    "the login view to reach done",
    { pollMs: 500 },
  );
  note(`login view reads ${done.state}`);

  const state = await waitFor(
    async () => {
      const read = await accountState(sb);
      return read === "available" || read === "near-limit" ? read : null;
    },
    2 * MINUTE,
    "account A to leave needs-login",
    { pollMs: 500 },
  );
  note(`account A reads ${state}`);

  const closed = await waitFor(
    async () => {
      const item = (await decisionsOf(sb, "answered")).find(
        (d) => d.id === open[0].id,
      );
      return item ?? null;
    },
    MINUTE,
    "the login decision to read answered",
    { pollMs: 500 },
  );
  assert.equal(closed.answer?.optionId, "login");
  note(
    `decision stays answered with login, note ${JSON.stringify(closed.answer?.note)}`,
  );
  assert.deepEqual(await decisionsOf(sb, "open"), []);
  const named = (await decisionsOf(sb)).filter(namesAccountA);
  assert.equal(
    named.length,
    1,
    `a second decision names account A: ${JSON.stringify(named)}`,
  );

  assert.ok(
    sb
      .tmux(["list-sessions", "-F", "#{session_name}"])
      .split("\n")
      .includes(tmuxSession),
    "the loop tmux session is gone",
  );
  const row = await sessionRow(sb, token);
  assert.equal(row?.claudeAccountId, ACCOUNT_A);
  assert.notEqual(row?.claudeAccountStale, true);
  const repliesBefore = readTranscript(transcripts.loop).filter(
    (r) => r.type === "assistant" && r.text === LOOP_REPLY,
  ).length;
  const input = await orch(sb, token, "POST", `/sessions/${CARD}/input`, {
    text: "Continue with the next step.",
  });
  assert.equal(input.status, 200, JSON.stringify(input.body));
  await waitFor(
    () =>
      readTranscript(transcripts.loop).filter(
        (r) => r.type === "assistant" && r.text === LOOP_REPLY,
      ).length > repliesBefore,
    MINUTE,
    "a new reply of the loop session after the login",
    { pollMs: 500 },
  );
  note("the loop session still answers a prompt");
}

void test(
  "scenario 14: a rejected account raises one login decision and the answered login clears it",
  { timeout: 15 * MINUTE },
  async () => {
    const usage = await startUsageServer({});
    const sb = await startSandbox({
      name: SANDBOX_NAME,
      usageUrl: usage.url,
      usageTimeScale: USAGE_TIME_SCALE,
      seed: ({ dir }) => {
        seedAccounts(dir);
        writeIdentityFiles();
      },
      env: {
        FAKE_CLAUDE_LOGIN_IDENTITY_FILE: LOGIN_IDENTITY_FILE,
        FAKE_CLAUDE_IDENTITY_FILE: HOME_IDENTITY_FILE,
      },
    });
    try {
      await runLoginDecision(sb, usage);
    } finally {
      await finish(
        sb,
        usage,
        path.join(EVIDENCE_DIR, "scenario-14-login-decision-run-log.txt"),
      );
    }
  },
);
