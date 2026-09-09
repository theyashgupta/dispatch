import assert from "node:assert/strict";
import { test } from "node:test";
import { findMarkdownPaths, markdownFilePath, viewerUrl } from "./md-links.js";

test("a file: URI to a .md file resolves to the viewer, any other file does not", () => {
  const md = markdownFilePath("file:///Users/y/ws/docs/My%20Report.md");
  assert.equal(md, "/Users/y/ws/docs/My Report.md");
  assert.equal(
    viewerUrl("http://localhost:4710", md),
    "http://localhost:4710/viewer/?path=%2FUsers%2Fy%2Fws%2Fdocs%2FMy%20Report.md",
  );
  assert.equal(markdownFilePath("file:///Users/y/ws/src/app.ts"), null);
  assert.equal(markdownFilePath("https://example.com/README.md"), null);
  assert.equal(markdownFilePath("not a uri"), null);
});

test("plain-text .md paths are found, other paths and URLs are not", () => {
  assert.deepEqual(findMarkdownPaths("⎿  Wrote 3 lines to docs/report.md."), [
    { text: "docs/report.md", index: 20 },
  ]);
  assert.deepEqual(findMarkdownPaths("see `./notes.markdown` and /abs/x.md"), [
    { text: "./notes.markdown", index: 5 },
    { text: "/abs/x.md", index: 27 },
  ]);
  assert.deepEqual(findMarkdownPaths("Write(src/app.ts) and page.mdx"), []);
  assert.deepEqual(findMarkdownPaths("https://example.com/a/README.md"), []);
});
