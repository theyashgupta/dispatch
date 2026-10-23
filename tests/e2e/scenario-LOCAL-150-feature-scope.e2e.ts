import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { Card } from "../../src/shared/types.js";
import { ORCHESTRATOR_TOKEN_HEADER } from "../../src/shared/orchestrator-limits.js";
import { QUICK_FIX_PLAYBOOK } from "./fixtures/scenario-6/orchestrator.js";
import { makeSampleRepo } from "./fixtures/scenario-1/repo.js";
import { readyRows } from "./fixtures/scenario-1/status-rows.js";
import { cardOf, writeRunLog } from "./harness/board-reads.js";
import {
  EVIDENCE_DIR,
  MINUTE,
  PORT_FIRST,
  PORT_LAST,
  SANDBOX_ROOT,
  assertSafePort,
  makeNote,
  startSandbox,
  waitFor,
  type Sandbox,
} from "./harness/sandbox.js";

const BOARD = "FSC";
const TICKET = "FSC-1";
const FEATURE_ID = "feat";
const RUN_LOG = path.join(EVIDENCE_DIR, "local-150-feature-scope-run-log.txt");

const note = makeNote("local-150-feature-scope");

interface Reply<T = Record<string, unknown>> {
  status: number;
  body: T;
}

interface CardList {
  cards: { id: string }[];
  total: number;
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
      [ORCHESTRATOR_TOKEN_HEADER]: token,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  return {
    status: res.status,
    body: (text === "" ? {} : JSON.parse(text)) as T,
  };
}

/** Add an orchestrator record to the board and mint its token without starting it. */
async function addAndMint(
  sb: Sandbox,
  id: string,
  role: "main" | "extra",
  kind: "board" | "feature",
): Promise<string> {
  const added = await sb.api<{ orchestrator: { kind: string } }>(
    "POST",
    `/api/boards/${BOARD}/orchestrators`,
    { id, name: id, role },
  );
  assert.equal(added.status, 201, JSON.stringify(added.body));
  assert.equal(added.body.orchestrator.kind, kind);
  const minted = await sb.api<{ token: string }>(
    "POST",
    `/api/boards/${BOARD}/orchestrators/${id}/token`,
  );
  assert.equal(minted.status, 201, JSON.stringify(minted.body));
  assert.notEqual(minted.body.token, "");
  return minted.body.token;
}

/** Create the board, the policy and the user ticket, add both orchestrators, and return their tokens. */
async function setup(
  sb: Sandbox,
): Promise<{ mainToken: string; featureToken: string }> {
  const sample = makeSampleRepo(sb.root, sb.home);
  const sessions = path.join(sb.workspaces, "fsc-sessions");
  fs.mkdirSync(sessions, { recursive: true });
  const board = await sb.api("POST", "/api/boards", {
    key: BOARD,
    name: "Feature scope board",
    workspaceRoot: sessions,
    repositories: [
      { path: sample.repo, baseBranch: "main", checkCommand: "true" },
    ],
  });
  assert.equal(board.status, 201);
  const policy = await sb.api("PUT", `/api/boards/${BOARD}/policy`, {
    roadmapApproval: "ask",
    concurrencyCap: 2,
    loopModel: "claude-sonnet-5-5:high",
    orchestratorModel: "claude-sonnet-5-5",
    handoffPercent: 50,
    handoffHardPercent: 80,
    usageLimit: "stop",
    shipRights: "none",
    budgetPerGroup: null,
    supervisor: "on",
    groupPlaybook: null,
  });
  assert.equal(policy.status, 200);
  const mainToken = await addAndMint(sb, "main", "main", "board");
  const featureToken = await addAndMint(sb, FEATURE_ID, "extra", "feature");
  const made = await sb.api<{ id: string }>(
    "POST",
    `/api/cards?board=${BOARD}`,
    { title: "Add the profile page", description: "One feature of one page." },
  );
  assert.equal(made.status, 201);
  assert.equal(made.body.id, TICKET);
  fs.writeFileSync(
    path.join(sb.scenarios, `${TICKET}.json`),
    JSON.stringify({ statusRows: readyRows(), reply: "ok" }),
  );
  note("board, orchestrators and ticket created");
  return { mainToken, featureToken };
}

async function assertListings(
  sb: Sandbox,
  mainToken: string,
  featureToken: string,
  featureIds: string[],
): Promise<void> {
  const feature = await orch<CardList>(sb, featureToken, "GET", "/cards");
  assert.equal(feature.status, 200);
  assert.equal(feature.body.total, featureIds.length);
  assert.deepEqual(
    feature.body.cards.map((c) => c.id),
    featureIds,
  );
  const main = await orch<CardList>(sb, mainToken, "GET", "/cards");
  assert.equal(main.status, 200);
  assert.ok(main.body.cards.some((c) => c.id === TICKET));
}

/** Check that the feature start is refused and that the ticket has no launch and no session afterwards. */
async function assertOutOfScopeStart(
  sb: Sandbox,
  featureToken: string,
): Promise<void> {
  const refused = await orch<{ error: string }>(
    sb,
    featureToken,
    "POST",
    `/cards/${TICKET}/start`,
    { playbook: QUICK_FIX_PLAYBOOK },
  );
  assert.equal(refused.status, 403);
  assert.equal(refused.body.error, "out-of-scope");
  const card = await cardOf(sb, BOARD, TICKET);
  assert.equal(card?.column, "todo");
  assert.equal(card?.launch, undefined);
  assert.equal(card?.tmuxSession, undefined);
  assert.equal(card?.sessions?.length ?? 0, 0);
  note(`${TICKET} start refused with out-of-scope`);
}

async function assignToFeature(sb: Sandbox): Promise<void> {
  const assigned = await sb.api<{
    cardId: string;
    orchestratorId: string;
    changed: boolean;
  }>("PUT", `/api/boards/${BOARD}/cards/${TICKET}/orchestrator`, {
    orchestratorId: FEATURE_ID,
  });
  assert.equal(assigned.status, 200, JSON.stringify(assigned.body));
  assert.equal(assigned.body.cardId, TICKET);
  assert.equal(assigned.body.orchestratorId, FEATURE_ID);
  assert.equal(assigned.body.changed, true);
  const intake = (await sb.orchestrationEvents(BOARD)).filter(
    (e) =>
      e.kind === "intake_submitted" &&
      e.data.orchestratorId === FEATURE_ID &&
      e.data.cardId === TICKET,
  );
  assert.equal(intake.length, 1);
  note(`${TICKET} assigned to ${FEATURE_ID}`);
}

/** Start the ticket as the feature orchestrator and check the launch, then check that the main now gets other-owner. */
async function assertOwnedStart(
  sb: Sandbox,
  mainToken: string,
  featureToken: string,
): Promise<Card> {
  const started = await orch(
    sb,
    featureToken,
    "POST",
    `/cards/${TICKET}/start`,
    {
      playbook: QUICK_FIX_PLAYBOOK,
      direction: "Build the profile page and report done.",
    },
  );
  assert.equal(started.status, 202, JSON.stringify(started.body));
  const card = await waitFor(
    async () => {
      const read = await cardOf(sb, BOARD, TICKET);
      return read?.tmuxSession !== undefined ? read : null;
    },
    4 * MINUTE,
    `the session of ${TICKET}`,
  );
  assert.equal(card.launch?.playbook, QUICK_FIX_PLAYBOOK);
  const taken = await orch<{ error: string }>(
    sb,
    mainToken,
    "POST",
    `/cards/${TICKET}/start`,
    { playbook: QUICK_FIX_PLAYBOOK },
  );
  assert.equal(taken.status, 403);
  assert.equal(taken.body.error, "other-owner");
  note(`${TICKET} started by ${FEATURE_ID}, main refused with other-owner`);
  return card;
}

/** Check that the sandbox folders sit under the sandbox root and not under the real `~/.dispatch`. */
function assertSandboxPaths(sb: Sandbox): void {
  const realDispatch = path.join(os.homedir(), ".dispatch");
  const inside = (parent: string, child: string): boolean =>
    child === parent || child.startsWith(`${parent}${path.sep}`);
  for (const folder of [sb.root, sb.dir, sb.home, sb.workspaces]) {
    assert.ok(inside(SANDBOX_ROOT, path.resolve(folder)), folder);
    assert.equal(inside(realDispatch, path.resolve(folder)), false, folder);
  }
}

/**
 * Run a board with a main orchestrator and a feature orchestrator that has an empty scope, and follow one ticket into the scope of the feature.
 *
 * @remarks Neither orchestrator is started. The test mints their tokens and calls the orchestrator routes itself,
 * so the only session is the one that the feature `start_card` launches.
 */
async function runScenario(sb: Sandbox): Promise<void> {
  const { mainToken, featureToken } = await setup(sb);
  await assertListings(sb, mainToken, featureToken, []);
  await assertOutOfScopeStart(sb, featureToken);
  await assignToFeature(sb);
  await assertListings(sb, mainToken, featureToken, [TICKET]);
  await assertOwnedStart(sb, mainToken, featureToken);
  assertSandboxPaths(sb);
}

void test(
  "scenario-LOCAL-150-feature-scope: a feature orchestrator with an empty scope sees and starts only the ticket that the user assigns to it",
  { timeout: 20 * MINUTE },
  async () => {
    const sb = await startSandbox({ name: "local-150-feature-scope" });
    try {
      assert.ok(sb.port >= PORT_FIRST && sb.port <= PORT_LAST);
      assertSafePort(sb.port);
      note(`sandbox port ${sb.port}`);
      await runScenario(sb);
    } finally {
      try {
        await writeRunLog(sb, BOARD, RUN_LOG);
      } catch (err) {
        note(
          `run log not written: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      await sb.stop();
    }
  },
);

void test("scenario-LOCAL-150-feature-scope code types no key into any pane", () => {
  const typing = new RegExp(
    [
      ["send", "keys"].join("-?"),
      ["send", "Literal"].join(""),
      ["paste", "buffer"].join("-"),
      ["load", "buffer"].join("-"),
    ].join("|"),
    "i",
  );
  assert.equal(
    typing.test(fs.readFileSync(import.meta.filename, "utf8")),
    false,
  );
});
