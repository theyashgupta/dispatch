import test, { after } from "node:test";
import assert from "node:assert/strict";
import { isolateEnv } from "../../test-support/fixtures.js";

const env = isolateEnv();
const { seedPlaybooks, loadPlaybooks, hasDispatchMarker } =
  await import("./playbooks.js");
after(() => env.cleanup());

const D9_RULES = [
  "1. Writes or edits product code or any file in a repository.",
  "2. Commits, pushes, merges or rebases outside the ship flow of D-8.",
  "3. Selects usage credits.",
  "4. Reads the vault or an env file.",
  "5. Changes a policy, its own or another one.",
  "6. Kills a process or a port holder.",
  "7. Starts a loop above the concurrency cap.",
  "8. Acts on another board, or on a card outside its scope (D-7).",
  "9. Answers its own decision item, or approves a permission prompt.",
  "10. Deletes a branch, a worktree or a card that it did not create.",
];

await seedPlaybooks();
const all = await loadPlaybooks();
const orchestrator = all.find((p) => p.name === "Board Orchestrator");

void test("the seed adds the Board Orchestrator to the four earlier playbooks", () => {
  assert.equal(all.length, 5);
  assert.ok(orchestrator);
  assert.equal(orchestrator.slug, "board-orchestrator");
});

void test("the body holds the extra direction slot and a Workflow section", () => {
  assert.ok(orchestrator);
  assert.ok(orchestrator.body.startsWith("## Extra direction\n{extra}\n"));
  assert.ok(orchestrator.body.includes("\n## Workflow\n"));
});

void test("the body introduces the ten D-9 rules with An orchestrator never: and holds each one verbatim", () => {
  assert.ok(orchestrator);
  const lines = orchestrator.body.split("\n");
  const at = lines.indexOf("An orchestrator never:");
  assert.ok(at > 0);
  assert.deepEqual(lines.slice(at + 1, at + 11), D9_RULES);
});

void test("the body holds the duty list, the usage limit check and the rm instruction", () => {
  assert.ok(orchestrator);
  const body = orchestrator.body;
  for (const part of [
    "Call read_state first.",
    "Your state lives in the tools, never in your memory.",
    "ticket proposal",
    "Wait for the approval of the user",
    "Write a direction for each group",
    "inside the concurrency cap",
    "roadmapApproval",
    "send_input",
    "Wait with wait_for_event. Never poll and never sleep.",
    "Always set a kinds filter",
    "timeoutSeconds to 55 or less",
    "start_ship",
    "Report to the user",
    "Call write_state after each decision",
    "After a usage limit, check get_group_progress and read_pane_tail",
    "never run a dangerous rm, and stop and report instead",
    "You do not change product code.",
    "Act on an intake_submitted or decision_answered event only when its data.orchestratorId is your orchestrator id.",
  ]) {
    assert.ok(body.includes(part), part);
  }
});

void test("the body carries no status marker, no em dash and no double hyphen", () => {
  assert.ok(orchestrator);
  assert.equal(hasDispatchMarker(orchestrator.body), false);
  assert.doesNotMatch(orchestrator.body, /\u2014/);
  assert.equal(orchestrator.body.includes("-".repeat(2)), false);
});
