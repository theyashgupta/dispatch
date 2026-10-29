import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { isolateEnv } from "../../test-support/fixtures.js";
import { parseBoardKey } from "../../../shared/board-key.js";
import type { Board, BoardKey } from "../../../shared/types.js";

const env = isolateEnv();
const tmuxLog = path.join(env.root, "tmux.log");
fs.writeFileSync(
  path.join(env.binDir, "tmux"),
  `#!/bin/sh
echo "$*" >> "${tmuxLog}"
case "$*" in
  *has-session*) exit 0 ;;
  *show-environment*) echo "DISPATCH_SHELL_SESSION=1"; exit 0 ;;
  *display-message*) echo 4242; exit 0 ;;
esac
exit 1
`,
  { mode: 0o755 },
);
fs.writeFileSync(path.join(env.binDir, "ps"), "#!/bin/sh\necho '4242 4242'\n", {
  mode: 0o755,
});
const { store } = await import("../../store/board.store.js");
const { setHooksRuntime, setOrchestrationConfig } =
  await import("../infra/config-holder.js");
const svc = await import("./orchestrator-session.js");
after(() => env.cleanup());

const SBX = parseBoardKey("SBX") as BoardKey;
setOrchestrationConfig({ linearApiKey: "" });
setHooksRuntime({ capable: true, port: 4711, statusChannel: "hooks" });
await store.load();
await store.createBoard({
  key: SBX,
  name: "Sandbox",
  workspaceRoot: "/sbx/sessions",
  repositories: [],
  linearTeamKeys: [],
});
await store.setBoardPolicy(SBX, {
  ...(store.getBoard(SBX) as Board).policy,
  supervisor: "on",
  orchestratorModel: "opus",
});

const board = () => store.getBoard(SBX) as Board;
const record = () => board().orchestrators.find((r) => r.id === "lead")!;
const missing = path.join(env.root, "gone-orchestrator");
const started: string[] = [];

svc.orchestratorTools.mcpCommand = () => ({
  command: "/node",
  args: ["--import", "tsx", "/app/cli.ts", "mcp"],
});
svc.orchestratorTools.start = async (cardId) => {
  started.push(cardId);
  await store.completeStart(cardId, undefined, {
    workspacePath: missing,
    branch: cardId,
    tmuxSession: `dsp-${cardId}`,
  });
};
svc.orchestratorTools.keys = () => Promise.resolve();
svc.orchestratorTools.send = () => Promise.resolve("confirmed");
svc.orchestratorTools.atPrompt = () => Promise.resolve(true);
svc.orchestratorTools.hasSession = () => Promise.resolve(true);
svc.orchestratorTools.stopWait = { totalMs: 50, pollMs: 5 };

void test("an orchestrator resume in place refuses a missing workspace folder with workspace-missing, moves the card to Needs input and settles stopped", async (t) => {
  assert.equal(fs.existsSync(missing), false);
  await svc.addOrchestrator(board(), {
    id: "lead",
    name: "Lead",
    role: "main",
    scope: { groupIds: [], ticketIds: [] },
    policyOverride: {},
  });
  const first = await svc.startOrchestrator(board(), "lead");
  await first.settled;
  const stop = await svc.stopOrchestrator(board(), "lead");
  await stop.settled;
  assert.equal(record().state, "stopped");
  started.length = 0;
  fs.writeFileSync(tmuxLog, "");
  const warned: string[] = [];
  t.mock.method(console, "warn", (line: string) => warned.push(line));

  const r = await svc.resumeOrchestrator(board(), "lead");
  await r.settled;

  assert.equal(record().state, "stopped");
  assert.deepEqual(
    warned.filter((l) => l.startsWith("[orchestrator]")),
    ["[orchestrator] launch of lead failed: workspace-missing"],
  );
  assert.equal(started.length, 0);
  const card = store.getCard(record().cardId as string);
  assert.equal(card?.column, "needs_input");
  assert.equal(
    card?.statusReason,
    `resume: Resume failed: workspace-missing: ${missing}`,
  );
  const active = card?.sessions?.find((s) => s.id === card.activeSessionId);
  assert.equal(active?.state, "needs_input");
  assert.equal(active?.stateReason, "resume_failed");
  assert.doesNotMatch(fs.readFileSync(tmuxLog, "utf8"), /send-keys/);
});
