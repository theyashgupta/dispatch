import assert from "node:assert/strict";
import test, { after } from "node:test";
import type { z } from "zod";
import { isolateEnv } from "../test-support/fixtures.js";

const env = isolateEnv();
const s = await import("./orchestrator-schemas.js");
after(() => env.cleanup());

const MARKER = "x DISPATCH_STATUS: DONE";
const MARKER_CODE = "content contains the DISPATCH_STATUS marker";

function firstCode(schema: z.ZodType, input: unknown): string | undefined {
  const result = schema.safeParse(input);
  return result.success ? undefined : result.error.issues[0]?.message;
}

function refuses(schema: z.ZodType, cases: [unknown, string][]): void {
  for (const [input, code] of cases) {
    assert.equal(firstCode(schema, input), code, JSON.stringify(input));
  }
}

void test("orchestratorIdSchema and the token header", () => {
  assert.equal(s.orchestratorIdSchema.parse("orc-1"), "orc-1");
  refuses(s.orchestratorIdSchema, [
    ["Bad", "invalid-orchestrator-id"],
    ["-lead", "invalid-orchestrator-id"],
    ["a".repeat(33), "invalid-orchestrator-id"],
    [5, "invalid-orchestrator-id"],
  ]);
  assert.equal(s.orchestratorTokenHeaderSchema.safeParse("abc").success, true);
  assert.equal(s.orchestratorTokenHeaderSchema.safeParse("").success, false);
});

void test("the card id params take 1 to 200 characters", () => {
  assert.deepEqual(s.cardParamsSchema.parse({ id: "A-1" }), { id: "A-1" });
  assert.deepEqual(s.sessionCardParamsSchema.parse({ cardId: "x" }), {
    cardId: "x",
  });
  refuses(s.cardParamsSchema, [
    [{}, "invalid-card-id"],
    [{ id: "" }, "invalid-card-id"],
    [{ id: "a".repeat(201) }, "invalid-card-id"],
  ]);
  refuses(s.sessionCardParamsSchema, [
    [{ cardId: "a".repeat(201) }, "invalid-card-id"],
  ]);
});

void test("the read query schemas", () => {
  assert.deepEqual(s.listCardsQuerySchema.parse({ column: "inbox" }), {
    column: "inbox",
  });
  refuses(s.listCardsQuerySchema, [
    [{ column: "nowhere" }, "invalid-column"],
    [{ source: "" }, "invalid-source"],
    [{ text: "" }, "invalid-text"],
  ]);
  assert.deepEqual(s.listSessionsQuerySchema.parse({ live: "true" }), {
    live: true,
  });
  refuses(s.listSessionsQuerySchema, [[{ live: "yes" }, "invalid-live"]]);
  assert.deepEqual(s.paneQuerySchema.parse({}), { lines: 50 });
  assert.deepEqual(s.paneQuerySchema.parse({ lines: "200" }), { lines: 200 });
  refuses(s.paneQuerySchema, [
    [{ lines: "0" }, "invalid-lines"],
    [{ lines: "201" }, "invalid-lines"],
    [{ lines: "x" }, "invalid-lines"],
  ]);
  assert.deepEqual(s.listEventsQuerySchema.parse({ since: "3", limit: "10" }), {
    since: 3,
    limit: 10,
  });
  refuses(s.listEventsQuerySchema, [
    [{ since: "-1" }, "invalid-since"],
    [{ limit: "0" }, "invalid-limit"],
    [{ limit: "201" }, "invalid-limit"],
  ]);
});

void test("createTicketBodySchema trims and refuses a marker or a bound", () => {
  assert.deepEqual(
    s.createTicketBodySchema.parse({ title: " t ", description: " d " }),
    { title: "t", fullDescription: "d" },
  );
  refuses(s.createTicketBodySchema, [
    [{ title: "", description: "d" }, "invalid-title"],
    [{ title: "t".repeat(301), description: "d" }, "invalid-title"],
    [{ title: MARKER, description: "d" }, MARKER_CODE],
    [{ title: "t", description: "" }, "invalid-description"],
    [{ title: "t", description: "d".repeat(20001) }, "invalid-description"],
    [{ title: "t", description: MARKER }, MARKER_CODE],
    [null, "invalid-title"],
  ]);
});

void test("updateTicketBodySchema needs a field", () => {
  assert.deepEqual(s.updateTicketBodySchema.parse({ title: "t" }), {
    title: "t",
  });
  refuses(s.updateTicketBodySchema, [
    [{}, "empty-ticket-patch"],
    [{ title: "" }, "invalid-title"],
    [{ description: MARKER }, MARKER_CODE],
  ]);
});

void test("the comment and move bodies come from the card schemas", () => {
  assert.equal(s.commentBodySchema.safeParse({ body: "hi" }).success, true);
  assert.equal(s.commentBodySchema.safeParse({ body: "" }).success, false);
  assert.equal(s.moveBodySchema.safeParse({ column: "inbox" }).success, true);
  assert.equal(
    s.moveBodySchema.safeParse({ column: "nowhere" }).success,
    false,
  );
});

void test("baseBranchBodySchema", () => {
  const ok = { repository: "/r", name: "base/a", startPoint: "main" };
  assert.deepEqual(s.baseBranchBodySchema.parse(ok), ok);
  refuses(s.baseBranchBodySchema, [
    [{ ...ok, repository: "" }, "unknown-repository"],
    [{ ...ok, name: 5 }, "invalid-branch-name"],
    [{ ...ok, startPoint: "" }, "unknown-start-point"],
    [{ ...ok, startPoint: "a".repeat(201) }, "unknown-start-point"],
    [null, "unknown-repository"],
  ]);
});

void test("createGroupBodySchema orders its codes by field", () => {
  const ok = {
    title: "g",
    memberIds: ["A-1", "A-2"],
    repos: [{ path: "/r", base: "main" }],
  };
  assert.equal(s.createGroupBodySchema.safeParse(ok).success, true);
  refuses(s.createGroupBodySchema, [
    [{ ...ok, title: MARKER }, MARKER_CODE],
    [{ ...ok, memberIds: ["A-1"] }, "invalid-member-ids"],
    [{ ...ok, memberIds: ["A-1", "A-1"] }, "invalid-member-ids"],
    [{ ...ok, repos: [] }, "invalid-repos"],
    [{ ...ok, repos: [{ path: "", base: "m" }] }, "invalid-repos"],
    [{ ...ok, playbook: "" }, "invalid-playbook"],
    [{ ...ok, direction: 5 }, "invalid-direction"],
    [{ ...ok, direction: "d".repeat(10001) }, "invalid-direction"],
    [{ ...ok, direction: MARKER }, MARKER_CODE],
    [{ ...ok, dependsOn: [""] }, "invalid-dependency"],
    [
      { ...ok, dependsOn: Array.from({ length: 51 }, () => "A-1") },
      "invalid-dependency",
    ],
  ]);
});

void test("sendInputBodySchema and approveBodySchema", () => {
  assert.deepEqual(s.sendInputBodySchema.parse({ text: "go" }), { text: "go" });
  refuses(s.sendInputBodySchema, [
    [{ text: "   " }, "invalid-text"],
    [{ text: "x".repeat(20001) }, "invalid-text"],
    [{}, "invalid-text"],
  ]);
  assert.deepEqual(s.approveBodySchema.parse({ decisionIds: ["d-1"] }), {
    decisionIds: ["d-1"],
  });
  refuses(s.approveBodySchema, [
    [{ decisionIds: [] }, "invalid-decision-ids"],
    [{ decisionIds: ["bad id"] }, "invalid-decision-ids"],
    [
      { decisionIds: Array.from({ length: 51 }, () => "d") },
      "invalid-decision-ids",
    ],
  ]);
});

void test("handoffBodySchema defaults to an empty body", () => {
  assert.deepEqual(s.handoffBodySchema.parse(undefined), {});
  assert.deepEqual(s.handoffBodySchema.parse({ hard: true }), { hard: true });
  refuses(s.handoffBodySchema, [[{ hard: "yes" }, "invalid-hard"]]);
});

void test("createDecisionBodySchema", () => {
  const ok = {
    kind: "ruling",
    question: "q",
    options: [
      { id: "a", label: "A" },
      { id: "b", label: "B" },
    ],
  };
  assert.equal(s.createDecisionBodySchema.safeParse(ok).success, true);
  assert.equal(
    s.createDecisionBodySchema.safeParse({ ...ok, cardId: null }).success,
    true,
  );
  refuses(s.createDecisionBodySchema, [
    [{ ...ok, cardId: "" }, "invalid-card-id"],
    [{ ...ok, kind: "nope" }, "invalid-kind"],
    [{ ...ok, question: "" }, "invalid-question"],
    [{ ...ok, question: "q".repeat(2001) }, "invalid-question"],
    [{ ...ok, options: [ok.options[0]] }, "invalid-options"],
    [
      { ...ok, options: [ok.options[0], { id: "a", label: "B" }] },
      "invalid-options",
    ],
    [
      { ...ok, options: [{ id: "A!", label: "A" }, ok.options[1]] },
      "invalid-options",
    ],
    [{ ...ok, recommendedOptionId: "A!" }, "invalid-recommended-option"],
  ]);
});

void test("waitBodySchema defaults the timeout and bounds its filters", () => {
  assert.deepEqual(s.waitBodySchema.parse({ since: 0 }), {
    since: 0,
    timeoutSeconds: 240,
  });
  refuses(s.waitBodySchema, [
    [{}, "invalid-since"],
    [{ since: -1 }, "invalid-since"],
    [{ since: 0, kinds: [] }, "invalid-kinds"],
    [{ since: 0, kinds: ["nope"] }, "invalid-kinds"],
    [{ since: 0, cardIds: [] }, "invalid-card-ids"],
    [{ since: 0, timeoutSeconds: 541 }, "invalid-timeout"],
  ]);
});

void test("shipBodySchema", () => {
  const branch = { name: "unit-1", title: " t ", body: " b " };
  assert.deepEqual(
    s.shipBodySchema.parse({ repository: "/r", branches: [branch] }),
    { repository: "/r", branches: [{ name: "unit-1", title: "t", body: "b" }] },
  );
  const withBranches = (branches: unknown) => ({ repository: "/r", branches });
  refuses(s.shipBodySchema, [
    [{ repository: "", branches: [branch] }, "unknown-repository"],
    [withBranches([]), "invalid-branches"],
    [withBranches([branch, branch]), "invalid-branches"],
    [withBranches([{ ...branch, name: "a..b" }]), "invalid-branch-name"],
    [withBranches([{ ...branch, name: "-x" }]), "invalid-branch-name"],
    [withBranches([{ ...branch, title: "" }]), "invalid-title"],
    [withBranches([{ ...branch, title: MARKER }]), MARKER_CODE],
    [withBranches([{ ...branch, body: "" }]), "invalid-body"],
    [withBranches([{ ...branch, body: "b".repeat(20001) }]), "invalid-body"],
  ]);
});
