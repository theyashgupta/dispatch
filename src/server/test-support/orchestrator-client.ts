import {
  accessSync,
  constants,
  cpSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type {
  BoardPolicy,
  Card,
  DecisionItem,
  LoopProgress,
  OrchestrationEvent,
  ShipFlow,
} from "../../shared/types.js";
import { run } from "../adapters/exec.js";
import { materializeLoopFixture } from "./loop-fixtures.js";

export interface ToolOutcome<T = Record<string, unknown>> {
  body: T;
  isError: boolean;
}

export interface ScriptStep {
  step: string;
  tool: string;
  ok: boolean;
  detail: string;
}

export interface ManualScriptOptions {
  baseUrl: string;
  token: string;
  boardKey: string;
  repository: string;
  waitMs?: number;
}

interface ErrorBody {
  error?: string;
  reason?: string;
}

interface CardBody {
  card?: Card;
}

const CLI = "src/server/bootstrap/cli.ts";
const IMPORT_FLAG = "-".repeat(2) + "import";
const FINISHED = "built, awaiting /ship";
const POLL_MS = 500;
const ANSWER_DELAY_MS = 500;
const PAGE = 200;

export class OrchestratorClient {
  private constructor(
    private readonly client: Client,
    private readonly transport: StdioClientTransport,
  ) {}

  /**
   * Start `dispatch mcp` for one orchestrator token against the server on `port`.
   *
   * @remarks The child gets no `NODE_ENV`, the same environment a launched orchestrator session gets.
   */
  static async open(token: string, port: string): Promise<OrchestratorClient> {
    const env = { ...process.env } as Record<string, string>;
    delete env.NODE_ENV;
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [IMPORT_FLAG, "tsx", CLI, "mcp"],
      env: {
        ...env,
        DISPATCH_ORCHESTRATOR_TOKEN: token,
        DISPATCH_PORT: port,
      },
      stderr: "pipe",
    });
    const client = new Client({
      name: "orchestrator-client",
      version: "1.0.0",
    });
    await client.connect(transport);
    return new OrchestratorClient(client, transport);
  }

  /**
   * Call one tool and return its parsed JSON body and its `isError` flag.
   *
   * @remarks A body that is not JSON comes back as `{ error: <text> }`.
   */
  async call<T = Record<string, unknown>>(
    name: string,
    args: Record<string, unknown> = {},
  ): Promise<ToolOutcome<T>> {
    const result = await this.client.callTool({ name, arguments: args });
    const content = result.content as { type: string; text?: string }[];
    const text = content.map((part) => part.text ?? "").join("");
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      body = { error: text };
    }
    return { body: body as T, isError: result.isError === true };
  }

  async close(): Promise<void> {
    await this.client.close();
    await this.transport.close();
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function failure(outcome: ToolOutcome<ErrorBody>): string {
  const { error, reason } = outcome.body;
  return [error, reason].filter(Boolean).join(": ") || "tool error";
}

/**
 * Repeat `probe` every half second until it returns a value or the time is up.
 *
 * @returns The value, or null at the time limit.
 */
async function until<T>(
  waitMs: number,
  probe: () => Promise<T | null>,
): Promise<T | null> {
  const end = Date.now() + waitMs;
  for (;;) {
    const value = await probe();
    if (value !== null) return value;
    if (Date.now() >= end) return null;
    await sleep(POLL_MS);
  }
}

interface Script {
  mcp: OrchestratorClient;
  baseUrl: string;
  boardKey: string;
  repository: string;
  waitMs: number;
  steps: ScriptStep[];
}

function record(
  s: Script,
  step: string,
  tool: string,
  ok: boolean,
  detail: string,
): void {
  s.steps.push({ step, tool, ok, detail });
}

async function callTool<T extends object>(
  s: Script,
  step: string,
  name: string,
  args: Record<string, unknown>,
  check: (body: T) => string | null = () => null,
): Promise<ToolOutcome<T>> {
  const outcome = await s.mcp.call<T>(name, args);
  const problem = outcome.isError ? failure(outcome) : check(outcome.body);
  record(
    s,
    step,
    name,
    problem === null,
    problem ?? JSON.stringify(outcome.body).slice(0, 200),
  );
  return outcome;
}

async function userRoute(
  s: Script,
  method: string,
  route: string,
  body: unknown,
): Promise<number> {
  const res = await fetch(`${s.baseUrl}/api${route}`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.status;
}

async function setPolicy(
  s: Script,
  step: string,
  patch: Partial<BoardPolicy>,
): Promise<void> {
  const current = await s.mcp.call<{ policy?: BoardPolicy }>("get_policy");
  const { policy } = current.body;
  if (current.isError || !policy) {
    record(s, step, "PUT policy", false, "get_policy gave no policy");
    return;
  }
  const status = await userRoute(s, "PUT", `/boards/${s.boardKey}/policy`, {
    ...policy,
    ...patch,
  });
  record(s, step, "PUT policy", status === 200, JSON.stringify(patch));
}

async function latestEventId(s: Script): Promise<number> {
  let since = 0;
  for (;;) {
    const page = (
      await s.mcp.call<{ events?: unknown[]; cursor?: number }>("list_events", {
        since,
        limit: PAGE,
      })
    ).body;
    since = page.cursor ?? since;
    if ((page.events?.length ?? 0) < PAGE) return since;
  }
}

const confirmed = (body: { result?: string }) =>
  body.result === "confirmed" ? null : `result ${body.result}`;

async function createGroup(s: Script): Promise<string | undefined> {
  const ticketIds: string[] = [];
  for (const n of [1, 2, 3]) {
    const out = await callTool<CardBody>(s, "1." + n, "create_ticket", {
      title: `Scripted client ticket ${n}`,
      description: `Ticket ${n} of the scripted client run.`,
    });
    if (out.body.card) ticketIds.push(out.body.card.id);
  }
  const group = await callTool<CardBody>(
    s,
    "2",
    "create_group",
    {
      title: "Scripted client group",
      memberIds: ticketIds,
      repos: [{ path: s.repository, base: "main" }],
    },
    (body) => (body.card?.id ? null : "no card id"),
  );
  return group.body.card?.id;
}

async function startGroup(s: Script, groupId: string): Promise<void> {
  await callTool(s, "3.1", "start_group", { id: groupId });
  const live = await until(s.waitMs, async () => {
    const { sessions = [] } = (
      await s.mcp.call<{ sessions?: { cardId: string }[] }>("list_sessions", {
        live: true,
      })
    ).body;
    return sessions.some((x) => x.cardId === groupId) ? true : null;
  });
  record(
    s,
    "3.2",
    "list_sessions",
    live === true,
    live ? "group session is live" : "group session never went live",
  );
}

async function approveRoadmap(s: Script, groupId: string): Promise<void> {
  await setPolicy(s, "4.1", { roadmapApproval: "all" });
  await callTool(s, "4.2", "approve_roadmap", {
    cardId: groupId,
    decisionIds: ["manual-run"],
  });

  await setPolicy(s, "5.1", { roadmapApproval: "ask" });
  const since = await latestEventId(s);
  const item = await callTool<{ item?: DecisionItem }>(
    s,
    "5.2",
    "create_decision_item",
    {
      cardId: groupId,
      kind: "roadmap_approval",
      question: "Approve the plan of the scripted client group?",
      options: [
        { id: "approve", label: "Approve" },
        { id: "reject", label: "Reject" },
      ],
      recommendedOptionId: "approve",
    },
    (body) => (body.item?.id ? null : "no item id"),
  );
  const itemId = item.body.item?.id;
  if (!itemId) return;
  const waiting = s.mcp.call<{ event?: OrchestrationEvent }>("wait_for_event", {
    since,
    kinds: ["decision_answered"],
    cardIds: [groupId],
    timeoutSeconds: 60,
  });
  await sleep(ANSWER_DELAY_MS);
  const status = await userRoute(s, "POST", `/decisions/${itemId}/answer`, {
    optionId: "approve",
  });
  record(s, "5.3", "POST decision answer", status === 200, `status ${status}`);
  const waited = await waiting;
  const event = waited.body.event;
  record(
    s,
    "5.4",
    "wait_for_event",
    !waited.isError &&
      event?.kind === "decision_answered" &&
      event.data.decisionId === itemId,
    JSON.stringify(waited.body).slice(0, 200),
  );
  await callTool(s, "5.5", "approve_roadmap", {
    cardId: groupId,
    decisionIds: [itemId],
  });
}

/**
 * Step 7.0 and 7.1: copy the finished loop fixture into the group workspace and wait for it to read as finished.
 *
 * @returns The group workspace and the unit branches the loop names, or null with no workspace.
 */
async function finishLoop(
  s: Script,
  groupId: string,
): Promise<{ root: string; branches: string[] } | null> {
  const card = (await s.mcp.call<CardBody>("get_card", { id: groupId })).body
    .card;
  const root = card?.workspacePath;
  if (!root) {
    record(s, "7.0", "get_card", false, "group card has no workspacePath");
    return null;
  }

  const fixture = materializeLoopFixture("g11-complete");
  try {
    cpSync(fixture, root, { recursive: true });
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
  const branches = await until(s.waitMs, async () => {
    const { loopProgress } = (
      await s.mcp.call<{ loopProgress?: LoopProgress | null }>(
        "get_group_progress",
        { id: groupId },
      )
    ).body;
    const units = loopProgress?.units ?? [];
    const done =
      units.length > 0 &&
      units.every((u) => u.status === FINISHED) &&
      loopProgress?.engine?.closed === true;
    return done ? units.flatMap((u) => (u.branch ? [u.branch] : [])) : null;
  });
  record(
    s,
    "7.1",
    "get_group_progress",
    branches !== null,
    branches !== null
      ? "every unit is built and the engine is closed"
      : "the loop never read as finished",
  );
  return { root, branches: branches ?? [] };
}

/** The first folder under a `.sandbox` folder that holds `repository`, or null outside one. */
function sandboxFolder(repository: string): string | null {
  const parts = path.resolve(repository).split(path.sep);
  const at = parts.indexOf(".sandbox");
  return at === -1 || at + 1 >= parts.length
    ? null
    : parts.slice(0, at + 2).join(path.sep);
}

function isExecutable(file: string): boolean {
  try {
    accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** The real path of the first `gh` on this process PATH, or null. */
function ghOnPath(): string | null {
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    const file = path.join(dir, "gh");
    if (dir !== "" && isExecutable(file)) return realpathSync(file);
  }
  return null;
}

/**
 * The reason a ship must not start, or null when the origin is a local path and `gh` is the sandbox one.
 *
 * @remarks Pushes and merges must never reach a network remote. The origin of `worktree` must be an
 * absolute path, and the first `gh` on this process PATH must resolve inside the `.sandbox`
 * folder that holds `repository`.
 */
export async function shipPreflight(
  worktree: string,
  repository: string,
): Promise<string | null> {
  const origin = await run("git", ["remote", "get-url", "origin"], {
    cwd: worktree,
  }).then(
    (r) => r.stdout.trim(),
    () => "",
  );
  if (!path.isAbsolute(origin)) {
    return `origin is not an absolute local path: ${origin || "no origin remote"}`;
  }
  const folder = sandboxFolder(repository);
  if (folder === null) {
    return `repository ${repository} is not inside a .sandbox folder`;
  }
  const gh = ghOnPath();
  if (gh === null) return "no gh on PATH";
  const rel = path.relative(realpathSync(folder), gh);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    return `gh on PATH is ${gh}, outside ${folder}`;
  }
  return null;
}

/** The configured `Name <email>` of the worktree, or null when either value is empty. */
async function gitIdentity(worktree: string): Promise<string | null> {
  const read = (key: string) =>
    run("git", ["config", key], { cwd: worktree }).then(
      (r) => r.stdout.trim(),
      () => "",
    );
  const [name, email] = await Promise.all([
    read("user.name"),
    read("user.email"),
  ]);
  return name !== "" && email !== "" ? `${name} <${email}>` : null;
}

async function freeUnitBranch(
  worktree: string,
  branches: string[],
): Promise<string | null> {
  for (const name of branches) {
    const taken = await run(
      "git",
      ["rev-parse", "--verify", "--quiet", `refs/heads/${name}`],
      { cwd: worktree },
    ).then(
      () => true,
      () => false,
    );
    if (!taken) return name;
  }
  return null;
}

/**
 * Step 9.2: create a unit branch of the loop in the worktree and commit one file with the worktree identity.
 *
 * @remarks `start_ship` accepts only the unit branches the loop names, and the identity check at the
 * end of a ship compares against the identity the worktree has configured, so the commit sets none.
 *
 * @returns The branch name, or null after a recorded failure.
 */
async function commitUnitBranch(
  s: Script,
  worktree: string,
  branches: string[],
): Promise<string | null> {
  try {
    const branch = await freeUnitBranch(worktree, branches);
    if (branch === null) {
      throw new Error(
        `every unit branch of the loop already exists (${branches.join(", ")}); reset the sandbox repository`,
      );
    }
    const identity = await gitIdentity(worktree);
    if (identity === null) throw new Error("the worktree has no git identity");
    await run("git", ["checkout", "-b", branch], { cwd: worktree });
    writeFileSync(path.join(worktree, "scripted-client.txt"), `${branch}\n`);
    await run("git", ["add", "scripted-client.txt"], { cwd: worktree });
    await run("git", ["commit", "-m", "Add the scripted client marker file"], {
      cwd: worktree,
    });
    record(s, "9.2", "git commit", true, `${branch} by ${identity}`);
    return branch;
  } catch (err) {
    record(s, "9.2", "git commit", false, (err as Error).message.slice(0, 200));
    return null;
  }
}

async function shipBranch(
  s: Script,
  groupId: string,
  branch: string,
): Promise<void> {
  await callTool(s, "9.3", "start_ship", {
    cardId: groupId,
    repository: s.repository,
    branches: [
      {
        name: branch,
        title: "Scripted client change",
        body: "Opened by the scripted client run.",
      },
    ],
  });
  let stopped = "";
  const shipped = await until(s.waitMs, async () => {
    const { body, isError } = await s.mcp.call<{ flow?: ShipFlow }>(
      "get_ship_state",
      { cardId: groupId },
    );
    const flow = body.flow;
    if (isError || !flow) return null;
    if (flow.state === "stopped") {
      stopped = `stopped at ${flow.failedStep}: ${flow.reason}`;
      return flow;
    }
    const first = flow.branches[0];
    return first?.state === "waiting_merge" && first.pr ? flow : null;
  });
  const first = shipped?.branches[0];
  record(
    s,
    "9.4",
    "get_ship_state",
    shipped !== null && stopped === "" && (first?.pr ?? 0) > 0,
    stopped || (first ? `${first.state}, PR ${first.pr}` : "no ship state"),
  );
}

async function shipSteps(
  s: Script,
  groupId: string,
  loop: { root: string; branches: string[] },
): Promise<void> {
  const worktree = path.join(loop.root, path.basename(s.repository));
  const problem = await shipPreflight(worktree, s.repository);
  record(
    s,
    "9.1",
    "ship preflight",
    problem === null,
    problem ?? "origin is a local path and gh is the sandbox gh",
  );
  if (problem !== null) return;
  const branch = await commitUnitBranch(s, worktree, loop.branches);
  if (branch !== null) await shipBranch(s, groupId, branch);
}

/**
 * Replay the manual orchestration run through MCP tool calls and user routes.
 *
 * @remarks The user routes carry no orchestrator token, because the server refuses one there. The
 * ship steps need the repository `origin` to be a local bare repository and the `gh` on this
 * process PATH to be the sandbox one, or step 9.1 fails and nothing ships. The server needs the
 * fake `gh` first on its own PATH.
 */
export async function runManualScript(
  opts: ManualScriptOptions,
): Promise<ScriptStep[]> {
  const { baseUrl, token, boardKey, repository } = opts;
  const s: Script = {
    mcp: await OrchestratorClient.open(token, new URL(baseUrl).port),
    baseUrl,
    boardKey,
    repository,
    waitMs: opts.waitMs ?? 120_000,
    steps: [],
  };
  try {
    const groupId = await createGroup(s);
    if (!groupId) return s.steps;
    await startGroup(s, groupId);
    await approveRoadmap(s, groupId);
    await callTool<{ result?: string }>(
      s,
      "6",
      "send_input",
      { cardId: groupId, text: "Scripted client answer." },
      confirmed,
    );
    const loop = await finishLoop(s, groupId);
    await callTool(s, "7.2", "request_handoff", { cardId: groupId });
    await callTool(s, "8.1", "stop_session", { cardId: groupId });
    await callTool(s, "8.2", "resume_loop", { cardId: groupId });
    if (loop) await shipSteps(s, groupId, loop);
  } finally {
    await s.mcp.close();
  }
  return s.steps;
}
