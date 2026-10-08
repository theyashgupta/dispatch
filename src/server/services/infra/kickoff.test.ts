import { DEFAULT_BOARD_KEY } from "../../../shared/board-key.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Card } from "../../../shared/types.js";
import { attachmentsDir } from "./paths.js";
import { buildKickoff } from "./kickoff.js";

const NAME_A = "aaaaaaaaaaaaaaaa.png";
const NAME_B = "bbbbbbbbbbbbbbbb.jpg";
const LINKED = `Fix the header.\n\n## Screenshots\n\n![screenshot 1](attachments/${NAME_A})\n\n![screenshot 2](attachments/${NAME_B})`;

function card(over: Partial<Card>): Card {
  return {
    id: "LOCAL-3",
    boardKey: DEFAULT_BOARD_KEY,
    issueId: "LOCAL-3",
    identifier: "LOCAL-3",
    title: "Header bug",
    description: LINKED,
    priority: 0,
    column: "todo",
    updatedAt: "",
    source: "local",
    ...over,
  };
}

test("a local card with attachment links lists absolute paths in order and rewrites the links", () => {
  const out = buildKickoff(card({}), "", ["repo"]);
  const dir = attachmentsDir("LOCAL-3");
  const lines = out.split("\n");
  const at = lines.indexOf("## Attached images");
  assert.ok(at > 0);
  assert.equal(lines[at + 1], `${dir}/${NAME_A}`);
  assert.equal(lines[at + 2], `${dir}/${NAME_B}`);
  assert.match(
    lines[at + 4],
    /^Read every file listed above with the Read tool/,
  );
  assert.ok(out.includes(`![screenshot 1](${dir}/${NAME_A})`));
  assert.ok(!out.includes("](attachments/"));
  assert.ok(at < lines.indexOf("## Workspace"));
});

test("a local card without links gets no Attached-images section and keeps its description", () => {
  const out = buildKickoff(card({ description: "Plain text only" }), "", [
    "repo",
  ]);
  assert.ok(!out.includes("Attached images"));
  assert.ok(out.includes("## Description\nPlain text only"));
});

test("a Linear card is never given the section even when its description mentions attachments", () => {
  const out = buildKickoff(
    card({ source: "linear", url: "https://linear.app/x/issue/ABC-1" }),
    "",
    ["repo"],
  );
  assert.ok(!out.includes("Attached images"));
  assert.ok(!out.includes(attachmentsDir("LOCAL-3")));
});

test("a group kickoff rewrites its local members' links to absolute paths", () => {
  const group = card({ id: "GROUP-1", identifier: "GROUP-1", source: "group" });
  const out = buildKickoff(group, "", ["repo"], { members: [card({})] });
  assert.ok(out.includes(`](${attachmentsDir("LOCAL-3")}/${NAME_A})`));
  assert.ok(!out.includes("](attachments/"));
  assert.ok(!out.includes("Attached images"));
});

test("the status protocol block is unchanged by the section", () => {
  const withImages = buildKickoff(card({}), "", ["repo"]);
  const without = buildKickoff(card({ description: "x" }), "", ["repo"]);
  const tail = (s: string) => s.slice(s.indexOf("## Workspace"));
  assert.equal(tail(withImages), tail(without));
  assert.ok(withImages.includes("DISPATCH_STATUS: NEEDS_INPUT"));
});

test("a hidden orchestrator card gets only the playbook body with its direction", () => {
  const out = buildKickoff(
    card({
      source: "orchestrator",
      identifier: "LOCAL-9",
      title: "Orchestrator: Lead",
      description: "",
    }),
    "You are the orchestrator Lead.",
    [],
    {
      playbookBody:
        "## Extra direction\n{extra}\n\n## Workflow\nCall read_state.",
    },
  );
  assert.equal(
    out,
    "## Extra direction\nYou are the orchestrator Lead.\n\n## Workflow\nCall read_state.",
  );
  assert.ok(!out.includes("You are working on"));
  assert.ok(!out.includes("## Workspace"));
  assert.ok(!out.includes("Vault protocol"));
  assert.ok(!out.includes("DISPATCH_STATUS"));
  assert.ok(!out.includes("secrets configured"));
});

test("a hidden orchestrator card with no playbook gets its direction alone", () => {
  const out = buildKickoff(
    card({ source: "orchestrator", description: "" }),
    "Direction.",
    [],
  );
  assert.equal(out, "Direction.");
});
