import test from "node:test";
import assert from "node:assert/strict";
import { markdownImageSource } from "./markdown-image-source.js";

const BASE = "/api/cards/LOCAL-1/attachments";
const LINEAR = "https://uploads.linear.app/ws/abc/shot.png?x=1&y=2";

void test("an attachments path loads from the attachment base", () => {
  assert.equal(
    markdownImageSource("attachments/0123abcd.png", BASE),
    `${BASE}/0123abcd.png`,
  );
});

void test("an attachments path with dot segments or separators is not an image", () => {
  for (const name of ["..", ".", "../x", "a/b.png", "a%2Fb", "", "a b.png"]) {
    assert.equal(markdownImageSource(`attachments/${name}`, BASE), null);
  }
});

void test("an attachments path without a base is not an image", () => {
  assert.equal(markdownImageSource("attachments/0123abcd.png"), null);
});

void test("a Linear upload loads through the image proxy", () => {
  assert.equal(
    markdownImageSource(LINEAR),
    `/api/images?url=${encodeURIComponent(LINEAR)}`,
  );
  assert.equal(
    markdownImageSource(LINEAR, BASE),
    `/api/images?url=${encodeURIComponent(LINEAR)}`,
  );
});

void test("a plain URL is not an image and the base never touches it", () => {
  assert.equal(markdownImageSource("https://example.com/pic.png", BASE), null);
  assert.equal(markdownImageSource("http://uploads.linear.app/a.png"), null);
});
