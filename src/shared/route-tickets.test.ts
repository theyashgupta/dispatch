import assert from "node:assert/strict";
import { test } from "node:test";
import { parseRoute, routeHash } from "./route.js";

test("#/tickets parses to the tickets page and round trips", () => {
  assert.deepEqual(parseRoute("#/tickets"), { page: "tickets" });
  assert.equal(routeHash({ page: "tickets" }), "#/tickets");
});
