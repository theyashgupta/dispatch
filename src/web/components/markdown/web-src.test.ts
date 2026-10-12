import assert from "node:assert/strict";
import { test } from "node:test";
import { isAppHref, isHttpSrc } from "./web-src.js";

test("isHttpSrc accepts absolute http and https urls in any case", () => {
  assert.equal(isHttpSrc("https://example.test/a.png"), true);
  assert.equal(isHttpSrc("http://example.test/a.png"), true);
  assert.equal(isHttpSrc("HTTPS://example.test/a.png"), true);
});

test("isHttpSrc refuses javascript, data, mailto, protocol-relative and relative srcs", () => {
  for (const bad of [
    "javascript:alert(1)",
    "data:image/png;base64,AAAA",
    "mailto:a@example.test",
    "//example.test/a.png",
    "/a.png",
    "a.png",
    "ftp://example.test/a.png",
    " https://example.test/a.png",
    "",
  ]) {
    assert.equal(isHttpSrc(bad), false, bad);
  }
});

test("isAppHref accepts only hash routes", () => {
  assert.equal(isAppHref("#/boards/ENG"), true);
  for (const bad of [
    "#",
    "#section",
    "/boards/ENG",
    "javascript:alert(1)",
    "https://example.test/#/a",
    " #/boards/ENG",
    "",
  ]) {
    assert.equal(isAppHref(bad), false, bad);
  }
});
