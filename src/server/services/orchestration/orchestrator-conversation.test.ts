import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { isolateEnv, waitFor } from "../../test-support/fixtures.js";
import { parseBoardKey } from "../../../shared/board-key.js";
import type { Board, BoardKey, Card, Session } from "../../../shared/types.js";

const env = isolateEnv();
const { store } = await import("../../store/board.store.js");
const { setHooksRuntime, setOrchestrationConfig } =
  await import("../infra/config-holder.js");
const { addOrchestrator, orchestratorTools, startOrchestrator } =
  await import("./orchestrator-session.js");
const { readOrchestratorConversation } =
  await import("./orchestrator-conversation.js");
const { NotFoundError } = await import("../domain/errors.js");

const CNV = parseBoardKey("CNV") as BoardKey;
setOrchestrationConfig({ linearApiKey: "" });
setHooksRuntime({ capable: true, port: 4711, statusChannel: "hooks" });
await store.load();
await store.createBoard({
  key: CNV,
  name: "CNV",
  workspaceRoot: path.join(env.root, "cnv"),
  repositories: [],
  linearTeamKeys: [],
});
const board = () => store.getBoard(CNV) as Board;
await store.setBoardPolicy(CNV, { ...board().policy, supervisor: "on" });
orchestratorTools.mcpCommand = () => ({ command: "/node", args: ["mcp"] });
orchestratorTools.start = async (cardId) => {
  await store.completeStart(cardId, undefined, {
    workspacePath: path.join(env.root, "cnv", cardId),
    branch: cardId,
    tmuxSession: `dsp-${cardId}`,
  });
};
after(() => env.cleanup());

const line = (entry: unknown) => JSON.stringify(entry) + "\n";

async function started(id: string) {
  const ticket = await store.createLocalCard(CNV, `${id} ticket`, "");
  await addOrchestrator(board(), {
    id,
    name: id,
    role: "extra",
    scope: { groupIds: [], ticketIds: [ticket.id] },
    policyOverride: {},
  });
  await startOrchestrator(board(), id);
  await waitFor(
    () =>
      Promise.resolve(
        board().orchestrators.find((r) => r.id === id)?.state === "running",
      ),
    2000,
    `${id} running`,
  );
  const card = store.getCard(
    board().orchestrators.find((r) => r.id === id)?.cardId ?? "",
  );
  return { cardId: card?.id ?? "", sessionId: card?.activeSessionId ?? "" };
}

void test("an unknown orchestrator id is a typed 404", async () => {
  await assert.rejects(
    readOrchestratorConversation(board(), "ghost", 200),
    (err) =>
      err instanceof NotFoundError && err.code === "unknown-orchestrator",
  );
});

void test("an orchestrator that never started has no session", async () => {
  await addOrchestrator(board(), {
    id: "idle",
    name: "idle",
    role: "main",
    scope: { groupIds: [], ticketIds: [] },
    policyOverride: {},
  });
  assert.deepEqual(await readOrchestratorConversation(board(), "idle", 200), {
    status: "no-session",
    messages: [],
    truncated: false,
  });
});

void test("a session with no transcript file answers no-transcript, an unreadable file answers unreadable", async () => {
  const { cardId, sessionId } = await started("lead");
  assert.equal(
    (await readOrchestratorConversation(board(), "lead", 200)).status,
    "no-transcript",
  );
  const file = path.join(env.root, "locked", "projects", "x", "t.jsonl");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, line({ type: "user", message: { content: "hi" } }));
  fs.chmodSync(file, 0o000);
  try {
    await store.setTranscriptPath(cardId, sessionId, file);
    assert.equal(
      (await readOrchestratorConversation(board(), "lead", 200)).status,
      "unreadable",
    );
  } finally {
    fs.chmodSync(file, 0o600);
  }
});

void test("Dispatch lines are system by their content wherever they sit, the user's turns are user", async () => {
  const { cardId, sessionId } = await started("ext");
  const file = path.join(env.root, "ext", "projects", "x", "t.jsonl");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    line({ type: "user", uuid: "u0", message: { content: "Go on." } }) +
      line({
        type: "user",
        uuid: "k",
        message: {
          content:
            '## Extra direction\nYou are the orchestrator "ext" (id ext) of board CNV.',
        },
      }) +
      line({
        type: "assistant",
        uuid: "a",
        message: { content: [{ type: "text", text: "Resumed." }] },
      }) +
      line({
        type: "user",
        uuid: "r",
        message: { content: "Resume as the ext orchestrator of board CNV." },
      }) +
      line({
        type: "user",
        uuid: "c",
        message: {
          content:
            "The usage limit has reset. Continue from where you stopped.",
        },
      }) +
      line({
        type: "user",
        uuid: "h",
        message: { content: "Context handoff request. Your context is high." },
      }),
  );
  await store.setTranscriptPath(cardId, sessionId, file);
  const read = await readOrchestratorConversation(board(), "ext", 200);
  assert.deepEqual(
    read.messages.map((m) => [m.id, m.role]),
    [
      ["u0", "user"],
      ["k", "system"],
      ["a", "orchestrator"],
      ["r", "system"],
      ["c", "system"],
      ["h", "system"],
    ],
  );
});

void test("every line Dispatch types into a session is a Dispatch line", async () => {
  const { isDispatchLine } = await import("../../../shared/dispatch-lines.js");
  const { wakeLine } = await import("../domain/orchestrator-wake.js");
  const handoff = await import("./supervisor-handoff.js");
  const { continueText } = await import("./supervisor-record.js");
  const card = { id: "CNV-1", workspacePath: "/w" } as Card;
  const session = { id: "s1" } as Session;
  const typed = [
    wakeLine(["CNV-1 needs input"]),
    handoff.handoffRequestText("slug", "/w", false),
    handoff.handoffRequestText("slug", "/w", true),
    handoff.orchestratorHandoffRequestText("main", false),
    handoff.orchestratorResumePromptText("main", "CNV"),
    ...(
      ["restart", "api_error", "sleep_cut", "resume", "usage_limit"] as const
    ).map((duty) => continueText(card, session, duty)),
  ];
  for (const text of typed) assert.equal(isDispatchLine(text), true, text);
});
