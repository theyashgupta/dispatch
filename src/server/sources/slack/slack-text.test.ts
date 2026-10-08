import assert from "node:assert/strict";
import { test } from "node:test";
import { renderSlackText, slackTitle } from "./slack-message.js";

const names = new Map([["U0G6ANA", "ana"]]);

test("user tokens render as @name, falling back to the id, ignoring Slack's label", () => {
  assert.equal(renderSlackText("<@U0G6ANA> hi", names), "@ana hi");
  assert.equal(renderSlackText("<@U0G6ANA|old> hi", names), "@ana hi");
  assert.equal(renderSlackText("<@U0G6BEN>", names), "@U0G6BEN");
});

test("a user token with a label and no known name renders the label", () => {
  assert.equal(renderSlackText("<@U0G6BEN|Ben Lee> hi", names), "@Ben Lee hi");
  assert.equal(renderSlackText("<@U0G6BEN|> hi", names), "@U0G6BEN hi");
  assert.equal(renderSlackText("<@U0G6ANA|Ana Q> hi", names), "@ana hi");
});

test("channel, broadcast, user group and link tokens render readably", () => {
  assert.equal(
    renderSlackText("<#C0G6ENG|eng-platform>", names),
    "#eng-platform",
  );
  assert.equal(renderSlackText("<#C0G6ENG>", names), "#C0G6ENG");
  assert.equal(
    renderSlackText("<!here> <!channel> <!everyone>", names),
    "@here @channel @everyone",
  );
  assert.equal(renderSlackText("<!subteam^S1|@platform>", names), "@platform");
  assert.equal(
    renderSlackText("<https://x.test/a|the doc> and <https://x.test/b>", names),
    "the doc and https://x.test/b",
  );
});

test("the three HTML entities decode, and &amp;lt; stays a literal &lt;", () => {
  assert.equal(renderSlackText("a &lt;b&gt; &amp; c", names), "a <b> & c");
  assert.equal(renderSlackText("&amp;lt;", names), "&lt;");
});

test("the title names author and place and cuts the text at 80 characters", () => {
  assert.equal(
    slackTitle("ana", "#eng-platform", "  short\n text "),
    "ana in #eng-platform: short text",
  );
  const long = "x".repeat(81);
  assert.equal(slackTitle("ana", "DM", long), `ana in DM: ${"x".repeat(80)}…`);
  assert.equal(
    slackTitle("ana", "group DM", "x".repeat(80)),
    `ana in group DM: ${"x".repeat(80)}`,
  );
});

test("a link label keeps a bar, and the title cut never splits an emoji", () => {
  assert.equal(renderSlackText("<https://x.test|a|b>", names), "a|b");
  const title = slackTitle("ana", "DM", `${"x".repeat(79)}\u{1F600}yz`);
  assert.equal(title, `ana in DM: ${"x".repeat(79)}\u{1F600}\u2026`);
});
