import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";
import { MCP_TOOLS, splitInput, type McpTool } from "./mcp-tools.js";

const EXPECTED = [
  "add_comment",
  "approve_roadmap",
  "create_base_branch",
  "create_decision_item",
  "create_group",
  "create_ticket",
  "get_card",
  "get_group_progress",
  "get_policy",
  "get_ship_state",
  "list_cards",
  "list_events",
  "list_sessions",
  "move_card",
  "read_pane_tail",
  "read_state",
  "request_handoff",
  "resume_loop",
  "send_input",
  "start_group",
  "start_ship",
  "stop_session",
  "update_ticket",
  "wait_for_event",
  "write_state",
];

const byName = (name: string): McpTool => {
  const tool = MCP_TOOLS.find((t) => t.name === name);
  assert.ok(tool, `tool ${name} exists`);
  return tool;
};

const refuses = (name: string, input: unknown) =>
  assert.equal(z.object(byName(name).input).safeParse(input).success, false);

const accepts = (name: string, input: unknown) =>
  assert.equal(z.object(byName(name).input).safeParse(input).success, true);

describe("mcp tool table", () => {
  it("holds exactly the 25 tools", () => {
    assert.deepEqual(MCP_TOOLS.map((t) => t.name).sort(), EXPECTED);
  });

  it("names no push, merge, credit, vault or policy change", () => {
    for (const { name, description } of MCP_TOOLS) {
      assert.doesNotMatch(name, /push|merge|credit|vault/i);
      assert.doesNotMatch(description, /push|merge|credit|vault/i);
      if (name !== "get_policy") {
        assert.doesNotMatch(name, /policy/i);
      }
      if (name !== "get_policy" && name !== "create_group") {
        assert.doesNotMatch(description, /policy/i);
      }
    }
  });

  it("words the create_group description as the contract says", () => {
    assert.equal(
      byName("create_group").description,
      "Create a group card from 2 or more cards. Omit playbook to use the board group playbook; get_policy lists the playbook names. Text that holds the status marker is refused.",
    );
  });

  it("gives every tool a description", () => {
    for (const { name, description } of MCP_TOOLS) {
      assert.ok(description.length > 20, name);
    }
  });

  it("refuses an invalid input for each tool", () => {
    const bad = "";
    const good = "ABC-1";
    refuses("get_card", { id: bad });
    refuses("get_card", { id: "x".repeat(201) });
    refuses("get_group_progress", {});
    refuses("read_pane_tail", { cardId: good, lines: 201 });
    refuses("list_cards", { column: "nowhere" });
    refuses("list_sessions", { live: "yes" });
    refuses("list_events", { limit: 0 });
    refuses("create_ticket", { title: "x" });
    refuses("create_ticket", { proposalItemId: "a", index: -1 });
    refuses("update_ticket", { id: good, title: "x".repeat(301) });
    refuses("move_card", { id: good, column: "nowhere" });
    refuses("add_comment", { id: good, body: "" });
    refuses("create_base_branch", { repository: "r", name: "n" });
    refuses("create_group", {
      title: "g",
      memberIds: ["ABC-1"],
      repos: [{ path: "p", base: "b" }],
    });
    refuses("start_group", { id: bad });
    refuses("send_input", { cardId: bad, text: "hi" });
    refuses("send_input", { cardId: good, text: "x".repeat(20001) });
    refuses("approve_roadmap", { cardId: good, decisionIds: [] });
    refuses("request_handoff", { cardId: good, hard: "yes" });
    refuses("resume_loop", { cardId: bad });
    refuses("stop_session", {});
    refuses("start_ship", { cardId: bad });
    refuses("get_ship_state", { cardId: bad });
    refuses("create_decision_item", {
      kind: "ruling",
      question: "q",
      options: [{ id: "a", label: "A" }],
    });
    refuses("wait_for_event", {});
    refuses("wait_for_event", { since: 0, timeoutSeconds: 56 });
    accepts("get_policy", {});
  });

  it("builds the route of each tool from a sample input", () => {
    const id = "ABC-12";
    const paths: Record<string, string> = {
      list_cards: "/cards",
      get_card: `/cards/${id}`,
      list_sessions: "/sessions",
      get_group_progress: `/groups/${id}/progress`,
      read_pane_tail: `/sessions/${id}/pane`,
      list_events: "/events",
      get_policy: "/policy",
      create_ticket: "/tickets",
      update_ticket: `/tickets/${id}`,
      move_card: `/tickets/${id}/move`,
      add_comment: `/tickets/${id}/comments`,
      create_base_branch: "/base-branches",
      create_group: "/groups",
      start_group: `/groups/${id}/start`,
      send_input: `/sessions/${id}/input`,
      approve_roadmap: `/groups/${id}/approve-roadmap`,
      request_handoff: `/sessions/${id}/handoff`,
      resume_loop: `/sessions/${id}/resume`,
      stop_session: `/sessions/${id}/stop`,
      start_ship: `/groups/${id}/ship`,
      get_ship_state: `/groups/${id}/ship`,
      create_decision_item: "/decisions",
      wait_for_event: "/events/wait",
      read_state: "/state",
      write_state: "/state",
    };
    for (const tool of MCP_TOOLS) {
      assert.equal(
        splitInput(tool, { id, cardId: id }).path,
        paths[tool.name],
        tool.name,
      );
    }
    assert.equal(byName("update_ticket").method, "PATCH");
    assert.equal(byName("get_ship_state").method, "GET");
    assert.equal(byName("start_ship").method, "POST");
    assert.equal(byName("read_state").method, "GET");
    assert.equal(byName("write_state").method, "PUT");
  });
});
