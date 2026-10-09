import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { z } from "zod";
import { isolateEnv } from "../test-support/fixtures.js";
import { MCP_TOOLS, splitInput, type McpTool } from "./mcp-tools.js";

const env = isolateEnv();
const schemas = await import("../routes/orchestrator-schemas.js");
const { COMMENT_BODY_MAX } = await import("../../shared/comment-body.js");
const limits = await import("../../shared/orchestrator-limits.js");
const { seedPlaybooks, loadPlaybooks } =
  await import("../services/infra/playbooks.js");
after(() => env.cleanup());

interface ServerSide {
  params?: z.ZodObject;
  query?: z.ZodType;
  body?: z.ZodType;
}

const SERVER: Record<string, ServerSide> = {
  list_cards: { query: schemas.listCardsQuerySchema },
  get_card: { params: schemas.cardParamsSchema },
  list_sessions: { query: schemas.listSessionsQuerySchema },
  get_group_progress: { params: schemas.cardParamsSchema },
  read_pane_tail: {
    params: schemas.sessionCardParamsSchema,
    query: schemas.paneQuerySchema,
  },
  list_events: { query: schemas.listEventsQuerySchema },
  get_policy: {},
  create_ticket: { body: schemas.createTicketBodySchema },
  update_ticket: {
    params: schemas.cardParamsSchema,
    body: schemas.updateTicketBodySchema,
  },
  move_card: { params: schemas.cardParamsSchema, body: schemas.moveBodySchema },
  add_comment: {
    params: schemas.cardParamsSchema,
    body: schemas.commentBodySchema,
  },
  create_base_branch: { body: schemas.baseBranchBodySchema },
  create_group: { body: schemas.createGroupBodySchema },
  start_group: { params: schemas.cardParamsSchema },
  send_input: {
    params: schemas.sessionCardParamsSchema,
    body: schemas.sendInputBodySchema,
  },
  approve_roadmap: {
    params: schemas.sessionCardParamsSchema,
    body: schemas.approveBodySchema,
  },
  request_handoff: {
    params: schemas.sessionCardParamsSchema,
    body: schemas.handoffBodySchema,
  },
  resume_loop: { params: schemas.sessionCardParamsSchema },
  stop_session: { params: schemas.sessionCardParamsSchema },
  start_ship: {
    params: schemas.sessionCardParamsSchema,
    body: schemas.shipBodySchema,
  },
  get_ship_state: { params: schemas.sessionCardParamsSchema },
  create_decision_item: { body: schemas.createDecisionBodySchema },
  wait_for_event: { body: schemas.waitBodySchema },
  read_state: {},
  write_state: { body: schemas.writeStateBodySchema },
};

const ID = "A-12";
const OPTIONS = [
  { id: "a", label: "A" },
  { id: "b", label: "B" },
];
const BRANCH = { name: "unit-1", title: "t", body: "b" };

const VALID: Record<string, Record<string, unknown>> = {
  list_cards: { column: "inbox", source: "linear", text: "x" },
  get_card: { id: ID },
  list_sessions: { live: true },
  get_group_progress: { id: "GROUP-4" },
  read_pane_tail: { cardId: ID, lines: 200 },
  list_events: { since: 0, limit: 200 },
  get_policy: {},
  create_ticket: { proposalItemId: "7f8e-41", index: 19 },
  update_ticket: { id: ID, title: "t", description: "d" },
  move_card: { id: ID, column: "inbox" },
  add_comment: { id: ID, body: "hello" },
  create_base_branch: { repository: "/r", name: "base/a", startPoint: "main" },
  create_group: {
    title: "g",
    memberIds: [ID, "LOCAL-2"],
    repos: [{ path: "/r", base: "main" }],
    playbook: "p",
    direction: "d",
    dependsOn: ["LOCAL-3"],
  },
  start_group: { id: ID },
  send_input: { cardId: ID, text: "go" },
  approve_roadmap: { cardId: ID, decisionIds: ["d-1"] },
  request_handoff: { cardId: ID, hard: true },
  resume_loop: { cardId: ID },
  stop_session: { cardId: ID },
  start_ship: { cardId: ID, repository: "/r", branches: [BRANCH] },
  get_ship_state: { cardId: ID },
  create_decision_item: {
    cardId: ID,
    kind: "ticket_proposal",
    question: "q",
    options: OPTIONS,
    recommendedOptionId: "a",
    tickets: [{ title: "t", description: "d" }],
  },
  wait_for_event: {
    since: 0,
    kinds: ["tool_call"],
    cardIds: [ID],
    timeoutSeconds: 55,
  },
  read_state: {},
  write_state: { markdown: "# State", handoffReady: true },
};

const REFUSED: [string, Record<string, unknown>][] = [
  ["get_card", { id: "" }],
  ["get_card", { id: "A".repeat(limits.CARD_ID_MAX + 1) }],
  ["list_cards", { column: "nowhere" }],
  ["list_sessions", { live: "yes" }],
  ["read_pane_tail", { cardId: ID, lines: 201 }],
  ["list_events", { limit: 0 }],
  ["list_events", { since: -1 }],
  ["create_ticket", { proposalItemId: "bad id!", index: 0 }],
  ["create_ticket", { proposalItemId: "7f8e-41", index: -1 }],
  ["create_ticket", { proposalItemId: "7f8e-41", index: 0.5 }],
  ["update_ticket", { id: ID, title: "t".repeat(limits.ITEM_TITLE_MAX + 1) }],
  ["move_card", { id: ID, column: "nowhere" }],
  ["add_comment", { id: ID, body: "" }],
  ["add_comment", { id: ID, body: "x".repeat(COMMENT_BODY_MAX + 1) }],
  ["create_base_branch", { repository: "", name: "n", startPoint: "main" }],
  ["create_base_branch", { repository: "/r", name: "n", startPoint: "" }],
  [
    "create_group",
    { title: "g", memberIds: [ID], repos: [{ path: "/r", base: "main" }] },
  ],
  ["create_group", { title: "g", memberIds: [ID, "LOCAL-2"], repos: [] }],
  [
    "create_group",
    {
      title: "g",
      memberIds: [ID, "LOCAL-2"],
      repos: [{ path: "/r", base: "main" }],
      direction: "d".repeat(limits.DIRECTION_MAX + 1),
    },
  ],
  ["send_input", { cardId: ID, text: "" }],
  [
    "send_input",
    { cardId: ID, text: "x".repeat(limits.SESSION_INPUT_MAX + 1) },
  ],
  ["approve_roadmap", { cardId: ID, decisionIds: [] }],
  ["approve_roadmap", { cardId: ID, decisionIds: ["bad id!"] }],
  ["request_handoff", { cardId: ID, hard: "yes" }],
  ["resume_loop", { cardId: "" }],
  ["stop_session", { cardId: "" }],
  ["start_ship", { cardId: ID, repository: "/r", branches: [] }],
  [
    "start_ship",
    { cardId: ID, repository: "/r", branches: [{ ...BRANCH, name: "a..b" }] },
  ],
  [
    "start_ship",
    { cardId: ID, repository: "/r", branches: [{ ...BRANCH, name: "-x" }] },
  ],
  [
    "start_ship",
    {
      cardId: ID,
      repository: "/r",
      branches: [{ ...BRANCH, title: "t".repeat(limits.SHIP_TITLE_MAX + 1) }],
    },
  ],
  ["get_ship_state", { cardId: "" }],
  [
    "create_decision_item",
    { kind: "ruling", question: "q", options: [OPTIONS[0]] },
  ],
  ["create_decision_item", { kind: "nope", question: "q", options: OPTIONS }],
  [
    "create_decision_item",
    {
      kind: "ruling",
      question: "q",
      options: [{ id: "A!", label: "A" }, OPTIONS[1]],
    },
  ],
  [
    "create_decision_item",
    {
      kind: "ruling",
      question: "q".repeat(limits.DECISION_QUESTION_MAX + 1),
      options: OPTIONS,
    },
  ],
  [
    "create_decision_item",
    {
      kind: "ticket_proposal",
      question: "q",
      options: OPTIONS,
      tickets: [{ title: "", description: "d" }],
    },
  ],
  [
    "create_decision_item",
    {
      kind: "ticket_proposal",
      question: "q",
      options: OPTIONS,
      tickets: Array(21).fill({ title: "t", description: "d" }),
    },
  ],
  ["wait_for_event", { since: -1 }],
  ["wait_for_event", { since: 0, timeoutSeconds: 541 }],
  ["wait_for_event", { since: 0, kinds: [] }],
  ["wait_for_event", { since: 0, kinds: ["nope"] }],
  [
    "write_state",
    { markdown: "m".repeat(limits.ORCHESTRATOR_STATE_MAX_BYTES + 1) },
  ],
  ["write_state", { markdown: "m", handoffReady: "yes" }],
  ["write_state", {}],
];

const byName = (name: string): McpTool => {
  const found = MCP_TOOLS.find((t) => t.name === name);
  assert.ok(found, `tool ${name} exists`);
  return found;
};

const mcpAccepts = (tool: McpTool, input: unknown) =>
  z.object(tool.input).safeParse(input).success;

/** Run the request that the tool builds from `input` through the schemas of its route. */
function serverAccepts(tool: McpTool, input: Record<string, unknown>): boolean {
  const server = SERVER[tool.name];
  const verdicts: boolean[] = [];
  const { rest, sendsRest } = splitInput(tool, input);
  if (server.params) {
    const [key] = Object.keys(server.params.shape);
    verdicts.push(server.params.safeParse({ [key]: input[key] }).success);
  }
  if (server.query) {
    const query = Object.fromEntries(
      Object.entries(rest)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, String(v)]),
    );
    verdicts.push(server.query.safeParse(query).success);
  }
  if (server.body) {
    const body: unknown = JSON.parse(JSON.stringify(sendsRest ? rest : {}));
    verdicts.push(server.body.safeParse(body).success);
  }
  return verdicts.every(Boolean);
}

describe("mcp tool table against the server schemas", () => {
  it("covers every tool with a server mapping and a valid sample", () => {
    const names = MCP_TOOLS.map((t) => t.name).sort();
    assert.deepEqual(Object.keys(SERVER).sort(), names);
    assert.deepEqual(Object.keys(VALID).sort(), names);
  });

  for (const tool of MCP_TOOLS) {
    it(`${tool.name}: one valid input passes the MCP and the server schema`, () => {
      const input = VALID[tool.name];
      assert.equal(mcpAccepts(tool, input), true, "mcp");
      assert.equal(serverAccepts(tool, input), true, "server");
    });
  }

  REFUSED.forEach(([name, input], index) => {
    it(`${name}: refused input ${index + 1} is refused by both`, () => {
      const tool = byName(name);
      assert.equal(serverAccepts(tool, input), false, "server");
      assert.equal(mcpAccepts(tool, input), false, "mcp");
    });
  });

  it("accepts a one letter team key, a long team key id and a Linear UUID card id", () => {
    const uuid = "3f2a9c1e-7b4d-4e8a-9c6f-1d2e3f4a5b6c";
    for (const [name, key] of [
      ["get_card", "id"],
      ["send_input", "cardId"],
    ] as const) {
      const tool = byName(name);
      for (const id of ["A-1", "ABCDEFGHIJ-99", uuid]) {
        const input = { ...VALID[name], [key]: id };
        assert.equal(mcpAccepts(tool, input), true, `${name} ${id}`);
        assert.equal(serverAccepts(tool, input), true, `${name} ${id}`);
      }
    }
  });

  it("refuses a card id over the shared limit in both schemas", () => {
    const tool = byName("get_card");
    const id = "x".repeat(limits.CARD_ID_MAX + 1);
    assert.equal(mcpAccepts(tool, { id }), false);
    assert.equal(serverAccepts(tool, { id }), false);
    assert.equal(mcpAccepts(tool, { id: id.slice(1) }), true);
  });

  it("offers move_card every column the route accepts", () => {
    const tool = byName("move_card");
    for (const column of limits.MOVABLE_COLUMNS) {
      assert.equal(mcpAccepts(tool, { id: ID, column }), true, column);
      assert.equal(serverAccepts(tool, { id: ID, column }), true, column);
    }
  });
});

describe("wait_for_event against the Board Orchestrator playbook", () => {
  it("caps and defaults the wait at the playbook limit and says so", async () => {
    await seedPlaybooks();
    const playbook = (await loadPlaybooks()).find(
      (p) => p.name === "Board Orchestrator",
    );
    assert.ok(playbook);
    const rule = /timeoutSeconds to (\d+)\./.exec(playbook.body);
    assert.ok(rule, "the playbook names a wait limit");
    const limit = Number(rule[1]);
    assert.equal(limit, 55);

    const tool = byName("wait_for_event");
    const schema = z.object(tool.input);
    assert.equal(schema.parse({ since: 0 }).timeoutSeconds, limit);
    assert.equal(mcpAccepts(tool, { since: 0, timeoutSeconds: limit }), true);
    assert.equal(
      mcpAccepts(tool, { since: 0, timeoutSeconds: limit + 1 }),
      false,
    );
    assert.ok(tool.description.includes(`at most ${limit} seconds`));
    assert.ok(tool.description.includes(`the default is ${limit}`));
    assert.ok(tool.description.includes("call it again to keep waiting"));
  });

  it("sends the default wait to the route when the call omits it", () => {
    const tool = byName("wait_for_event");
    const input = z.object(tool.input).parse({ since: 3 });
    assert.deepEqual(splitInput(tool, input).rest, {
      since: 3,
      timeoutSeconds: 55,
    });
  });
});
