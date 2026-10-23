import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import test from "node:test";
import type { Card } from "../../src/shared/types.js";
import { makeSampleRepo } from "./fixtures/scenario-1/repo.js";
import { readyRows } from "./fixtures/scenario-1/status-rows.js";
import { cardOf, writeRunLog } from "./harness/board-reads.js";
import {
  EVIDENCE_DIR,
  MINUTE,
  makeNote,
  startSandbox,
  waitFor,
  type OrchestrationEventRow,
  type Sandbox,
} from "./harness/sandbox.js";

const BOARD = "LAM";
const CARD = "LAM-1";
const ORCHESTRATOR_CARD = "LAM-2";
const ACCOUNT_A = "a1a1a1a1-0000-4000-8000-00000000000a";
const ACCOUNT_B = "b2b2b2b2-0000-4000-8000-00000000000b";
const ACCOUNT_C = "c3c3c3c3-0000-4000-8000-00000000000c";
const TOKENS: Record<string, string> = {
  [ACCOUNT_A]: "fake-a",
  [ACCOUNT_B]: "fake-b",
  [ACCOUNT_C]: "fake-c",
};
const CLAUDE_SESSION = "7d3e9f10-2b4c-4a5d-8e6f-0a1b2c3d4e5f";
const LIMIT_TEXT =
  "You've hit your weekly limit · resets Oct 20 at 8:30am (Asia/Calcutta)";
const CONTINUED_REPLY = "Continuing on the account with headroom.";
const MOVE_LIMIT_MS = 2 * MINUTE;
const DAY = 24 * 60 * 60 * 1000;

const note = makeNote("local-152-limit-account-move");

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
  limitedUntil: string | null;
  windows: { kind: string; percent: number }[];
}

interface TranscriptRow {
  type: string;
  text: string;
  model?: string;
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
  close: () => Promise<void>;
}

/**
 * Serve the usage endpoint on an ephemeral loopback port, one answer per fake token and a 401 for any other token.
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
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}

/**
 * Write the account registry and one config dir with a fake credentials file per account into the data folder.
 *
 * @remarks Runs before the server boots, so the first usage read already sees the accounts. Positions follow the array order after Default at 0.
 */
function seedAccounts(dir: string, ids: string[]): void {
  const root = path.join(dir, "claude-accounts");
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const at = "2026-10-01T00:00:00.000Z";
  ids.forEach((id) => {
    const configDir = path.join(root, id);
    fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(
      path.join(configDir, ".credentials.json"),
      JSON.stringify({ claudeAiOauth: { accessToken: TOKENS[id] } }),
      { mode: 0o600 },
    );
  });
  fs.writeFileSync(
    path.join(root, "accounts.json"),
    JSON.stringify({
      version: 2,
      defaultPosition: 0,
      accounts: ids.map((id, index) => ({
        id,
        email: `${TOKENS[id]}@example.com`,
        orgId: `org-${TOKENS[id]}`,
        orgName: `Org ${TOKENS[id]}`,
        subscriptionType: "max",
        createdAt: at,
        lastLoginAt: at,
        position: index + 1,
      })),
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
    name: "Limit move board",
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
 * Write the replay files of both cards and return the path of the transcript the loop card appends to.
 *
 * @remarks The loop card answers every prompt with the synthetic limit stop under account A and with a normal
 * reply under any other account. Both runs append to one transcript file, as a resumed conversation does.
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
      reply: CONTINUED_REPLY,
      transcriptPath: loop,
      exitOnExit: true,
      byConfigDir: { [ACCOUNT_A]: { limitStop: LIMIT_TEXT } },
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
  note(`${CARD} started on ${TOKENS[account]}`);
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
        message: { model?: string; content: string | { text: string }[] };
      };
      const { content, model } = entry.message;
      return {
        type: entry.type,
        text: typeof content === "string" ? content : (content[0]?.text ?? ""),
        ...(model === undefined ? {} : { model }),
      };
    });

const sessionRow = async (
  sb: Sandbox,
  token: string,
): Promise<SessionRow | undefined> =>
  (
    await orch<{ sessions: SessionRow[] }>(sb, token, "GET", "/sessions")
  ).body.sessions?.find((s) => s.cardId === CARD);

const accountRow = async (
  sb: Sandbox,
  token: string,
  id: string,
): Promise<AccountRow | undefined> =>
  (
    await orch<{ accounts: AccountRow[] }>(sb, token, "GET", "/accounts")
  ).body.accounts?.find((a) => a.id === id);

const supervisorActions = (events: OrchestrationEventRow[]): string =>
  events
    .filter((e) => e.kind === "supervisor_action" && e.cardId === CARD)
    .map(
      (e) =>
        `${JSON.stringify(e.data.action)}:${JSON.stringify(e.data.result ?? "")}`,
    )
    .join(", ");

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
 * Start a loop on account A while B is the active account, let A answer with the weekly limit stop, and check the loop continues on B.
 *
 * @remarks The session is not on the account in use, which is the case the chain controller ignores, so only the supervisor can move it.
 */
async function runLimitMove(sb: Sandbox): Promise<void> {
  await setupBoard(sb);
  const transcripts = writeScenarios(sb);
  const token = await startOrchestrator(sb, transcripts.orchestrator);
  const active = await sb.api("PUT", "/api/accounts/active", {
    id: ACCOUNT_B,
    applyToRunning: "none",
  });
  assert.equal(active.status, 200, JSON.stringify(active.body));

  const card = await startLoopOnAccount(sb, token, ACCOUNT_A);
  await postHook(sb, card.tmuxSession ?? "", {
    hook_event_name: "SessionStart",
    session_id: CLAUDE_SESSION,
    transcript_path: transcripts.loop,
  });
  await waitFor(
    () =>
      readTranscript(transcripts.loop).some(
        (row) => row.type === "assistant" && row.text === LIMIT_TEXT,
      ),
    4 * MINUTE,
    "the limit stop in the transcript of the session",
    { pollMs: 500 },
  );
  const limitAt = Date.now();
  note("the session stopped at the weekly limit on account A");

  const moved = await waitFor(
    async () => {
      const row = await sessionRow(sb, token);
      return row?.claudeAccountId === ACCOUNT_B ? row : null;
    },
    MOVE_LIMIT_MS,
    "the session to run on account B",
    { pollMs: 1000 },
  ).catch(() => null);
  const events = await sb.orchestrationEvents(BOARD);
  const row = moved ?? (await sessionRow(sb, token));
  note(
    `after ${Math.round((Date.now() - limitAt) / 1000)} s the session runs on ${row?.claudeAccountId}; supervisor actions: ${supervisorActions(events)}`,
  );
  assert.equal(
    row?.claudeAccountId,
    ACCOUNT_B,
    `the session stayed on ${row?.claudeAccountId} for ${MOVE_LIMIT_MS / 1000} s after the weekly limit; supervisor actions: ${supervisorActions(events)}`,
  );
  assert.notEqual(row?.claudeAccountStale, true);
  const limitMovesOf = (all: OrchestrationEventRow[]) =>
    all.filter(
      (e) =>
        e.kind === "supervisor_action" &&
        e.cardId === CARD &&
        e.data.action === "limit_move",
    );
  const limitMoves = await waitFor(
    async () => {
      const found = limitMovesOf(await sb.orchestrationEvents(BOARD));
      return found.length > 0 ? found : null;
    },
    Math.max(0, limitAt + MOVE_LIMIT_MS - Date.now()),
    "the limit_move event",
    { pollMs: 1000 },
  ).catch(() => limitMovesOf(events));
  assert.equal(
    limitMoves.length,
    1,
    `expected one limit_move event; supervisor actions: ${supervisorActions(events)}`,
  );
  assert.equal(limitMoves[0].data.from, ACCOUNT_A);
  assert.equal(limitMoves[0].data.to, ACCOUNT_B);
  assert.equal(limitMoves[0].data.result, "moved");
  const settled = await sessionRow(sb, token);
  assert.equal(settled?.claudeAccountId, ACCOUNT_B);
  assert.notEqual(settled?.claudeAccountStale, true);

  const continued = await waitFor(
    () =>
      readTranscript(transcripts.loop).some(
        (r) => r.type === "assistant" && r.text === CONTINUED_REPLY,
      ),
    MINUTE,
    "a normal reply from the fake under account B",
    { pollMs: 500 },
  );
  assert.equal(continued, true);
}

/**
 * Seed an account that the chain holds as limited for five more days, refresh it while its usage reads 13 percent, and check list_accounts stops calling it limited.
 */
async function runLimitedFlag(sb: Sandbox): Promise<void> {
  await setupBoard(sb);
  const transcripts = writeScenarios(sb);
  const token = await startOrchestrator(sb, transcripts.orchestrator);

  await waitFor(
    async () => {
      const row = await accountRow(sb, token, ACCOUNT_C);
      return row?.windows.some(
        (w) => w.kind === "weekly_all" && w.percent === 13,
      )
        ? row
        : null;
    },
    MINUTE,
    "the usage windows of account C",
    { pollMs: 500 },
  );
  const refreshed = await sb.api(
    "POST",
    `/api/accounts/${ACCOUNT_C}/usage/refresh`,
  );
  note(`manual refresh of C answered ${refreshed.status}`);
  assert.ok([200, 429].includes(refreshed.status));

  await waitFor(
    async () => (await accountRow(sb, token, ACCOUNT_C))?.state !== "limited",
    20_000,
    "account C to stop reading limited",
    { pollMs: 500 },
  ).catch(() => null);
  const row = await accountRow(sb, token, ACCOUNT_C);
  note(
    `list_accounts answers ${row?.state} for C, limitedUntil ${row?.limitedUntil}`,
  );
  assert.notEqual(
    row?.state,
    "limited",
    `list_accounts still answers limited until ${row?.limitedUntil} for an account whose fresh read shows weekly 13 percent`,
  );
}

/**
 * Start a loop on account A while B is the active account, let A answer with the weekly limit stop, and check that B above the headroom line leaves the loop waiting on A.
 *
 * @remarks The wait must show on the board as usage_limit_wait and no prompt may reach the fake after the limit text.
 */
async function runNoHeadroom(sb: Sandbox): Promise<void> {
  await setupBoard(sb);
  const transcripts = writeScenarios(sb);
  const token = await startOrchestrator(sb, transcripts.orchestrator);
  const active = await sb.api("PUT", "/api/accounts/active", {
    id: ACCOUNT_B,
    applyToRunning: "none",
  });
  assert.equal(active.status, 200, JSON.stringify(active.body));

  const card = await startLoopOnAccount(sb, token, ACCOUNT_A);
  await postHook(sb, card.tmuxSession ?? "", {
    hook_event_name: "SessionStart",
    session_id: CLAUDE_SESSION,
    transcript_path: transcripts.loop,
  });
  await waitFor(
    () =>
      readTranscript(transcripts.loop).some(
        (row) => row.type === "assistant" && row.text === LIMIT_TEXT,
      ),
    4 * MINUTE,
    "the limit stop in the transcript of the session",
    { pollMs: 500 },
  );
  const limitAt = Date.now();
  note("the session stopped at the weekly limit on account A");

  const limitWaitsOf = (all: OrchestrationEventRow[]) =>
    all.filter(
      (e) =>
        e.kind === "supervisor_action" &&
        e.cardId === CARD &&
        e.data.action === "limit_wait",
    );
  const waits = await waitFor(
    async () => {
      const found = limitWaitsOf(await sb.orchestrationEvents(BOARD));
      return found.length > 0 ? found : null;
    },
    MOVE_LIMIT_MS,
    "the limit_wait event",
    { pollMs: 1000 },
  ).catch(() => []);
  const events = await sb.orchestrationEvents(BOARD);
  note(
    `after ${Math.round((Date.now() - limitAt) / 1000)} s supervisor actions: ${supervisorActions(events)}`,
  );
  assert.ok(
    waits.length > 0,
    `no limit_wait event within ${MOVE_LIMIT_MS / 1000} s; supervisor actions: ${supervisorActions(events)}`,
  );
  assert.equal(waits[0].data.reason, "no_headroom");
  assert.equal(typeof waits[0].data.until, "string");
  assert.ok(!Number.isNaN(Date.parse(String(waits[0].data.until))));
  assert.ok(
    !events.some(
      (e) =>
        e.kind === "supervisor_action" &&
        e.cardId === CARD &&
        e.data.action === "limit_move",
    ),
    `a limit_move event exists; supervisor actions: ${supervisorActions(events)}`,
  );

  const row = await sessionRow(sb, token);
  assert.equal(row?.claudeAccountId, ACCOUNT_A);
  const waiting = await waitFor(
    async () => {
      const read = await cardOf(sb, BOARD, CARD);
      return read?.state === "usage_limit_wait" ? read : null;
    },
    MINUTE,
    "the board to read usage_limit_wait",
    { pollMs: 500 },
  ).catch(() => null);
  assert.equal(
    waiting?.state,
    "usage_limit_wait",
    `the board reads ${(await cardOf(sb, BOARD, CARD))?.state}`,
  );

  const rows = readTranscript(transcripts.loop);
  const limitIndex = rows.findIndex(
    (r) => r.type === "assistant" && r.text === LIMIT_TEXT,
  );
  assert.deepEqual(
    rows.slice(limitIndex + 1),
    [],
    "a prompt reached the fake after the limit text",
  );
}

void test(
  "scenario-LOCAL-152-limit-account-move: a loop on a weekly-limited account continues on the account with headroom",
  { timeout: 15 * MINUTE },
  async () => {
    const usage = await startUsageServer({
      "fake-a": [futureWindow("weekly_all", 100)],
      "fake-b": [futureWindow("weekly_all", 13), futureWindow("session", 7)],
    });
    const sb = await startSandbox({
      name: "local-152-limit-account-move-limit-move",
      usageUrl: usage.url,
      seed: ({ dir }) => seedAccounts(dir, [ACCOUNT_A, ACCOUNT_B]),
    });
    try {
      await runLimitMove(sb);
    } finally {
      await finish(
        sb,
        usage,
        path.join(
          EVIDENCE_DIR,
          "local-152-limit-account-move-limit-move-run-log.txt",
        ),
      );
    }
  },
);

void test(
  "scenario-LOCAL-152-limit-account-move: a fresh read under the limit clears a stale limited flag in list_accounts",
  { timeout: 10 * MINUTE },
  async () => {
    const usage = await startUsageServer({
      "fake-c": [futureWindow("weekly_all", 13), futureWindow("session", 7)],
    });
    const sb = await startSandbox({
      name: "local-152-limit-account-move-limited-flag",
      usageUrl: usage.url,
      seed: ({ dir }) => {
        seedAccounts(dir, [ACCOUNT_C]);
        const until = new Date(Date.now() + 5 * DAY).toISOString();
        fs.writeFileSync(
          path.join(dir, "claude-accounts", "chain-state.json"),
          JSON.stringify({
            accounts: {
              [ACCOUNT_C]: {
                state: "limited",
                buckets: [
                  { kind: "weekly_all", percent: 100, resetsAt: until },
                ],
                limitedUntil: until,
              },
            },
            inUseSince: null,
            exhausted: null,
            moves: [],
            loginExpiryNotified: {},
          }),
        );
      },
    });
    try {
      await runLimitedFlag(sb);
    } finally {
      await finish(
        sb,
        usage,
        path.join(
          EVIDENCE_DIR,
          "local-152-limit-account-move-limited-flag-run-log.txt",
        ),
      );
    }
  },
);

void test(
  "scenario-LOCAL-152-limit-account-move: with no account under the headroom line the loop waits at the limit and the board shows why",
  { timeout: 10 * MINUTE },
  async () => {
    const usage = await startUsageServer({
      "fake-a": [futureWindow("weekly_all", 100)],
      "fake-b": [futureWindow("weekly_all", 95), futureWindow("session", 7)],
    });
    const sb = await startSandbox({
      name: "local-152-limit-account-move-no-headroom",
      usageUrl: usage.url,
      seed: ({ dir }) => seedAccounts(dir, [ACCOUNT_A, ACCOUNT_B]),
    });
    try {
      await runNoHeadroom(sb);
    } finally {
      await finish(
        sb,
        usage,
        path.join(
          EVIDENCE_DIR,
          "local-152-limit-account-move-no-headroom-run-log.txt",
        ),
      );
    }
  },
);
