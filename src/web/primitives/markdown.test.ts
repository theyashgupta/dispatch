import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown } from "./Markdown.js";

const NAME = "0123456789abcdef.png";

function render(source: string, attachmentBase?: string): string {
  return renderToStaticMarkup(
    createElement(Markdown, { source, attachmentBase }),
  );
}

test("a relative attachment link renders as an image under the given base", () => {
  const html = render(
    `![shot 1](attachments/${NAME})`,
    "/api/cards/LOCAL-1/attachments",
  );
  assert.match(
    html,
    new RegExp(`<img[^>]*src="/api/cards/LOCAL-1/attachments/${NAME}"`),
  );
  assert.match(html, /alt="shot 1"/);
});

test("without a base the same link keeps today's external-link rendering", () => {
  const html = render(`![shot 1](attachments/${NAME})`);
  assert.ok(!html.includes("<img"));
  assert.match(html, new RegExp(`<a[^>]*href="attachments/${NAME}"`));
});

test("a non-attachment image is untouched by the base", () => {
  const html = render(
    "![pic](https://example.com/pic.png)",
    "/api/cards/LOCAL-1/attachments",
  );
  assert.ok(!html.includes("/api/cards/LOCAL-1/attachments"));
  assert.match(html, /href="https:\/\/example\.com\/pic\.png"/);
});
