import test, { after } from "node:test";
import assert from "node:assert/strict";
import { isolateEnv } from "../test-support/fixtures.js";
import { parseBoardKey } from "../../shared/board-key.js";
import type { Board, BoardKey, BoardPolicy } from "../../shared/types.js";

const env = isolateEnv();
const { store } = await import("../store/board.store.js");
const express = (await import("express")).default;
const { boardPolicyRouter } = await import("./board-policy.route.js");
const { httpErrorHandler } = await import("./error-handler.js");

const PLC = parseBoardKey("PLC") as BoardKey;
await store.load();
await store.createBoard({
  key: PLC,
  name: "Policy",
  workspaceRoot: "/plc/sessions",
  repositories: [],
  linearTeamKeys: [],
});

const app = express();
app.use("/api", express.json(), boardPolicyRouter, httpErrorHandler);
const server = await new Promise<import("node:http").Server>((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
after(() => {
  server.close();
  env.cleanup();
});

interface Reply {
  status: number;
  text: string;
  body: { board: Board; error?: string };
}

async function put(route: string, body: unknown): Promise<Reply> {
  const res = await fetch(`${base}${route}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, text, body: JSON.parse(text) as Reply["body"] };
}

const VALID: BoardPolicy = {
  roadmapApproval: "rules",
  concurrencyCap: 5,
  loopModel: "claude-sonnet-5-5:high",
  orchestratorModel: "opus",
  handoffPercent: 40,
  handoffHardPercent: 70,
  usageLimit: "stop",
  shipRights: "open_prs",
  budgetPerGroup: 25.5,
  supervisor: "off",
  groupPlaybook: null,
  wakeMinutes: 15,
};

function stored(): BoardPolicy | undefined {
  return store.getBoard(PLC)?.policy;
}

async function expectRefusal(
  body: unknown,
  status: number,
  error: string,
): Promise<void> {
  const before = JSON.stringify(stored());
  const got = await put("/boards/PLC/policy", body);
  assert.equal(got.status, status, got.text);
  assert.equal(got.body.error, error);
  assert.equal(
    JSON.stringify(stored()),
    before,
    "a refused body writes nothing",
  );
}

test("a valid full policy answers 200, the board carries it and the store holds it", async () => {
  const before = stored();
  assert.notDeepEqual(before, VALID);
  const got = await put("/boards/PLC/policy", VALID);
  assert.equal(got.status, 200, got.text);
  assert.equal(got.body.board.key, "PLC");
  assert.deepEqual(got.body.board.policy, VALID);
  assert.deepEqual(stored(), VALID);
});

test("a body that is not an object answers 400 invalid-policy and writes nothing", async () => {
  await expectRefusal([], 400, "invalid-policy");
});

test("an unknown field answers 400 and writes nothing", async () => {
  await expectRefusal({ ...VALID, extra: 1 }, 400, "unknown-field");
});

test("usageLimit credits answers 400 and writes nothing", async () => {
  await expectRefusal(
    { ...VALID, usageLimit: "credits" },
    400,
    "invalid-usageLimit",
  );
});

test("a negative concurrencyCap answers 400 and writes nothing", async () => {
  await expectRefusal(
    { ...VALID, concurrencyCap: -1 },
    400,
    "invalid-concurrencyCap",
  );
});

test("loops, handoff and hard handoff keep the ranges of the policy form", async () => {
  const ok: Partial<BoardPolicy>[] = [
    { concurrencyCap: 1 },
    { concurrencyCap: 10 },
    { handoffPercent: 10, handoffHardPercent: 11 },
    { handoffPercent: 95, handoffHardPercent: 100 },
  ];
  for (const patch of ok) {
    const got = await put("/boards/PLC/policy", { ...VALID, ...patch });
    assert.equal(got.status, 200, JSON.stringify(patch));
  }
  const refused: [Partial<BoardPolicy>, string][] = [
    [{ concurrencyCap: 11 }, "invalid-concurrencyCap"],
    [{ handoffPercent: 9 }, "invalid-handoffPercent"],
    [{ handoffPercent: 96, handoffHardPercent: 100 }, "invalid-handoffPercent"],
    [{ handoffPercent: 50, handoffHardPercent: 50 }, "hard-below-handoff"],
    [{ handoffHardPercent: 101 }, "invalid-handoffHardPercent"],
    [{ budgetPerGroup: 100_001 }, "invalid-budgetPerGroup"],
  ];
  for (const [patch, error] of refused) {
    await expectRefusal({ ...VALID, ...patch }, 400, error);
  }
});

test("handoffPercent 101 answers 400 and writes nothing", async () => {
  await expectRefusal(
    { ...VALID, handoffPercent: 101 },
    400,
    "invalid-handoffPercent",
  );
});

test("handoffHardPercent below handoffPercent answers 400 and writes nothing", async () => {
  await expectRefusal(
    { ...VALID, handoffPercent: 60, handoffHardPercent: 59 },
    400,
    "hard-below-handoff",
  );
});

test("an unknown board key answers 404", async () => {
  const got = await put("/boards/NOPE/policy", VALID);
  assert.equal(got.status, 404, got.text);
  assert.equal(got.body.error, "unknown-board");
});

test("an unknown orchestratorModel answers 400 and writes nothing", async () => {
  await expectRefusal(
    { ...VALID, orchestratorModel: "gpt-9" },
    400,
    "invalid-orchestratorModel",
  );
  await expectRefusal(
    { ...VALID, orchestratorModel: "" },
    400,
    "invalid-orchestratorModel",
  );
});

test("an unknown loopModel answers 400 and writes nothing", async () => {
  for (const loopModel of [
    "sonnet",
    "claude-opus-5-5",
    "claude-opus-5-5:low",
  ]) {
    await expectRefusal({ ...VALID, loopModel }, 400, "invalid-loopModel");
  }
});

test("the listed models are accepted, with the legacy name opus and a null loop model", async () => {
  for (const body of [
    { ...VALID, orchestratorModel: "claude-fable-5-1", loopModel: null },
    { ...VALID, orchestratorModel: "claude-sonnet-5-5" },
    { ...VALID, orchestratorModel: "opus", loopModel: "claude-opus-5-5:max" },
  ]) {
    const got = await put("/boards/PLC/policy", body);
    assert.equal(got.status, 200, got.text);
    assert.deepEqual(stored(), body);
  }
});

test("groupPlaybook accepts null and a playbook name and reads both back", async () => {
  for (const groupPlaybook of ["Write code directly", null]) {
    const got = await put("/boards/PLC/policy", { ...VALID, groupPlaybook });
    assert.equal(got.status, 200, got.text);
    assert.equal(got.body.board.policy.groupPlaybook, groupPlaybook);
    assert.equal(stored()?.groupPlaybook, groupPlaybook);
  }
});

test("an omitted groupPlaybook keeps the stored name and an explicit null clears it", async () => {
  await put("/boards/PLC/policy", { ...VALID, groupPlaybook: "Keep me" });
  const kept = await put("/boards/PLC/policy", {
    ...VALID,
    groupPlaybook: undefined,
  });
  assert.equal(kept.status, 200, kept.text);
  assert.equal(kept.body.board.policy.groupPlaybook, "Keep me");
  assert.equal(stored()?.groupPlaybook, "Keep me");
  const cleared = await put("/boards/PLC/policy", {
    ...VALID,
    groupPlaybook: null,
  });
  assert.equal(cleared.status, 200, cleared.text);
  assert.equal(cleared.body.board.policy.groupPlaybook, null);
  assert.equal(stored()?.groupPlaybook, null);
});

test("an empty, over 200 unit or non-string groupPlaybook answers 400 and writes nothing", async () => {
  for (const groupPlaybook of [
    "",
    "x".repeat(201),
    "\u{1F600}".repeat(101),
    5,
  ]) {
    await expectRefusal(
      { ...VALID, groupPlaybook },
      400,
      "invalid-groupPlaybook",
    );
  }
});

test("wakeMinutes accepts 0, 15 and 1440 and reads each back", async () => {
  for (const wakeMinutes of [0, 15, 1440]) {
    const got = await put("/boards/PLC/policy", { ...VALID, wakeMinutes });
    assert.equal(got.status, 200, got.text);
    assert.equal(got.body.board.policy.wakeMinutes, wakeMinutes);
    assert.equal(stored()?.wakeMinutes, wakeMinutes);
  }
});

test("wakeMinutes of -1, 1441, 1.5 or a string answers 400 and the policy does not change", async () => {
  for (const wakeMinutes of [-1, 1441, 1.5, "15"]) {
    await expectRefusal({ ...VALID, wakeMinutes }, 400, "invalid-wakeMinutes");
  }
});

test("an omitted wakeMinutes keeps the stored value", async () => {
  await put("/boards/PLC/policy", { ...VALID, wakeMinutes: 42 });
  const kept = await put("/boards/PLC/policy", {
    ...VALID,
    wakeMinutes: undefined,
  });
  assert.equal(kept.status, 200, kept.text);
  assert.equal(kept.body.board.policy.wakeMinutes, 42);
  assert.equal(stored()?.wakeMinutes, 42);
});
