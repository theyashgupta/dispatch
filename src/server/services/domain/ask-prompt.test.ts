import test from "node:test";
import assert from "node:assert/strict";
import { buildAskPrompt } from "./ask-prompt.js";

const LINES = ['{"kind":"card","identifier":"LOCAL-1"}', '{"kind":"sync"}'];

void test("the data sits between the fence tags", () => {
  const prompt = buildAskPrompt(LINES, [], "what needs me?");
  const open = prompt.indexOf("<dispatch-data>\n");
  const close = prompt.indexOf("\n</dispatch-data>");
  assert.ok(open > 0 && close > open);
  assert.equal(
    prompt.slice(open + "<dispatch-data>\n".length, close),
    LINES.join("\n"),
  );
});

void test("history turns appear in order with their role labels and the question is last", () => {
  const prompt = buildAskPrompt(
    LINES,
    [
      { role: "user", text: "what needs me right now" },
      { role: "assistant", text: "LOCAL-1 needs you" },
    ],
    "which of those is older?",
  );
  const first = prompt.indexOf("User: what needs me right now");
  const second = prompt.indexOf("Assistant: LOCAL-1 needs you");
  const question = prompt.indexOf("User: which of those is older?");
  assert.ok(prompt.indexOf("</dispatch-data>") < first);
  assert.ok(first < second && second < question);
  assert.ok(prompt.endsWith("User: which of those is older?"));
});

void test("an empty history has no turn labels before the question", () => {
  const prompt = buildAskPrompt(LINES, [], "what needs me?");
  const afterData = prompt.slice(prompt.indexOf("</dispatch-data>"));
  assert.equal(afterData.match(/^(User|Assistant): /gm)?.length, 1);
  assert.ok(prompt.endsWith("User: what needs me?"));
});
