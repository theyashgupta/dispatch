import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRoute, routeHash } from "./route.js";

test("#/slack parses with and without an item id and round-trips", () => {
  assert.deepEqual(parseRoute("#/slack"), { page: "slack" });
  const id = "slack:C0G6ENG:1790607974.050980";
  const route = { page: "slack" as const, id };
  assert.deepEqual(parseRoute(routeHash(route)), route);
  assert.equal(routeHash(route), "#/slack/slack%3AC0G6ENG%3A1790607974.050980");
});
