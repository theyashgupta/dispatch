import assert from "node:assert/strict";
import { test } from "node:test";
import { isWebUrl } from "./web-url.js";

test("isWebUrl accepts http and https urls", () => {
  assert.equal(isWebUrl("https://example.test/pr/1"), true);
  assert.equal(isWebUrl("http://example.test"), true);
});

test("isWebUrl refuses other schemes, malformed text and a missing url", () => {
  for (const bad of [
    "javascript:alert(1)",
    "data:text/html,x",
    "file:///etc/passwd",
    "not a url",
    "",
    undefined,
  ]) {
    assert.equal(isWebUrl(bad), false, String(bad));
  }
});
