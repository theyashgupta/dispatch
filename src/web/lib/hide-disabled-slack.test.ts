import assert from "node:assert/strict";
import { test } from "node:test";
import type { Item } from "../../shared/types.js";
import { hideDisabledSlack } from "./hide-disabled-slack.js";

const item = (key: string, source: string): Item => ({
  id: `${source}:${key}`,
  source,
  type: "mention",
  title: key,
  snippet: "",
  createdAt: "2026-09-28T00:00:00.000Z",
  priority: 75,
  state: "unread",
  meta: {},
});

const items = [item("a", "slack"), item("b", "github"), item("c", "slack")];

test("with Slack enabled every item stays", () => {
  assert.deepEqual(
    hideDisabledSlack(items, ["github", "slack"]).map((i) => i.id),
    ["slack:a", "github:b", "slack:c"],
  );
});

test("with Slack off only Slack items are dropped", () => {
  assert.deepEqual(
    hideDisabledSlack(items, ["github"]).map((i) => i.id),
    ["github:b"],
  );
  assert.deepEqual(
    hideDisabledSlack(items, []).map((i) => i.id),
    ["github:b"],
  );
});

test("an empty list stays empty", () => {
  assert.deepEqual(hideDisabledSlack([], []), []);
});
