import test, { after } from "node:test";
import assert from "node:assert/strict";
import { parseBoardKey } from "../../../shared/board-key.js";
import type { BoardKey, OrchestratorRecord } from "../../../shared/types.js";
import { isolateEnv } from "../../test-support/fixtures.js";
import { ConflictError } from "../domain/errors.js";

const env = isolateEnv();
const { store } = await import("../../store/board.store.js");
const { submitIntake } = await import("./intake.js");

const SBX = parseBoardKey("SBX") as BoardKey;
const BARE = parseBoardKey("BARE") as BoardKey;
await store.load();
for (const key of [SBX, BARE]) {
  await store.createBoard({
    key,
    name: key,
    workspaceRoot: `/${key.toLowerCase()}/sessions`,
    repositories: [],
    linearTeamKeys: [],
  });
}
const record = (id: string, role: "main" | "extra"): OrchestratorRecord => ({
  id,
  name: id,
  role,
  scope: { groupIds: [], ticketIds: [] },
  policyOverride: {},
  cardId: null,
  state: "stopped",
  createdAt: "2026-10-08T00:00:00.000Z",
});
await store.setBoardOrchestrators(SBX, [
  record("extra", "extra"),
  record("lead", "main"),
]);
after(() => env.cleanup());

const intakeEvents = (key: BoardKey) =>
  store
    .listOrchestrationEvents(key, 0, 1000)
    .filter((e) => e.kind === "intake_submitted");

void test("submitIntake appends one intake_submitted event for the main orchestrator", () => {
  const eventId = submitIntake(store.getBoard(SBX)!, {
    goal: "Ship the export feature",
    requirements: "CSV and JSON",
  });
  const [event] = intakeEvents(SBX);
  assert.equal(event.id, eventId);
  assert.equal(event.cardId, null);
  assert.deepEqual(event.data, {
    orchestratorId: "lead",
    goal: "Ship the export feature",
    requirements: "CSV and JSON",
  });
});

void test("submitIntake stores null for missing requirements and creates no ticket", () => {
  const cards = store.listCards(SBX).length;
  submitIntake(store.getBoard(SBX)!, { goal: "Only a goal" });
  assert.equal(intakeEvents(SBX).at(-1)?.data.requirements, null);
  assert.equal(store.listCards(SBX).length, cards);
});

void test("submitIntake refuses a board with no main orchestrator and appends nothing", () => {
  assert.throws(
    () => submitIntake(store.getBoard(BARE)!, { goal: "g" }),
    (err) =>
      err instanceof ConflictError && err.code === "no-main-orchestrator",
  );
  assert.equal(intakeEvents(BARE).length, 0);
});
