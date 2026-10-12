import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown } from "./Markdown.js";

const html = (source: string) =>
  renderToStaticMarkup(createElement(Markdown, { source }));

test("a hash route renders a same-tab anchor", () => {
  const out = html("[Open Billing](#/boards/BILLIN)");
  assert.match(out, /<a href="#\/boards\/BILLIN"/);
  assert.doesNotMatch(out, /target=/);
});

test("http, https and mailto anchors keep their rules", () => {
  assert.match(
    html("[a](https://example.test)"),
    /href="https:\/\/example.test" target="_blank" rel="noopener noreferrer"/,
  );
  const mail = html("[m](mailto:a@example.test)");
  assert.match(mail, /href="mailto:a@example.test"/);
  assert.doesNotMatch(mail, /target=/);
});

test("any other href renders as plain text", () => {
  for (const href of [
    "javascript:alert(1)",
    "data:text/html,x",
    "/boards/ENG",
    "#section",
    "ftp://example.test",
  ]) {
    const out = html(`[click](${href})`);
    assert.doesNotMatch(out, /<a /, href);
    assert.match(out, /<span>click<\/span>/, href);
  }
});

test("text in a code span never becomes a link or markup", () => {
  for (const name of [
    "[click](javascript:alert(1)) **bold** https://evil.test <b>x</b>",
    "www.evil.example",
    "x [x](https://evil.example)",
  ]) {
    const out = html(
      `Created board \`${name}\` with key EVIL. [Open \`${name}\`](#/boards/EVIL)`,
    );
    assert.equal((out.match(/<a /g) ?? []).length, 1, name);
    assert.match(out, /<a href="#\/boards\/EVIL"/, name);
    assert.doesNotMatch(out, /<(strong|b|img)[ >]/, name);
  }
});
