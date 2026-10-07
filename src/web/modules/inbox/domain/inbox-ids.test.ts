import assert from "node:assert/strict";
import { test } from "node:test";
import { inboxRowDomId } from "./inbox-ids.js";

test("inboxRowDomId prefixes the row id", () => {
  assert.equal(inboxRowDomId("github:acme/api"), "inbox-row-github:acme/api");
});
