import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type {
  UpdateRunResult,
  UpdateStatus,
} from "../../../../shared/types.js";
import { UpdateBanner } from "./UpdateBanner.js";

/** Returns the text of static markup with the apostrophe entity decoded. */
function textOf(html: string): string {
  let text = "";
  let inTag = false;
  for (const char of html) {
    if (char === "<") inTag = true;
    else if (char === ">") inTag = false;
    else if (!inTag) text += char;
  }
  return text.replaceAll("&#x27;", "'");
}

function status(extra: Partial<UpdateStatus> = {}): UpdateStatus {
  return {
    updateAvailable: true,
    current: "1.0.0",
    latest: "1.2.0",
    installMode: "global",
    ...extra,
  };
}

function render(
  props: {
    status?: UpdateStatus | null;
    dismissedVersion?: string | null;
    pending?: boolean;
    result?: UpdateRunResult;
    failed?: boolean;
  } = {},
): string {
  return renderToStaticMarkup(
    createElement(UpdateBanner, {
      status: status(),
      dismissedVersion: null,
      onDismiss: () => {},
      onRunUpdate: () => {},
      pending: false,
      result: undefined,
      failed: false,
      ...props,
    }),
  );
}

void test("no status and no available update render nothing", () => {
  assert.equal(render({ status: null }), "");
  assert.equal(render({ status: status({ updateAvailable: false }) }), "");
  assert.equal(render({ status: status({ latest: null }) }), "");
});

void test("a dismissed version renders nothing while idle", () => {
  assert.equal(render({ dismissedVersion: "1.2.0" }), "");
  assert.notEqual(render({ dismissedVersion: "1.1.0" }), "");
});

void test("an available global update offers Run update and a dismiss button", () => {
  const html = render();
  assert.match(textOf(html), /Update available: v1\.2\.0/);
  assert.match(textOf(html), /Run update/);
  assert.match(html, /aria-label="Dismiss update notice"/);
  assert.doesNotMatch(html, /Couldn't|Couldn&#x27;t/);
});

void test("an npx install shows the command and a copy button, with no Run update", () => {
  const html = render({ status: status({ installMode: "npx" }) });
  assert.match(
    textOf(html),
    /Update available: v1\.2\.0\. Run:npx @theyashgupta\/dispatch@latest/,
  );
  assert.match(html, /aria-label="Copy update command"/);
  assert.doesNotMatch(textOf(html), /Run update/);
});

void test("a dev checkout says to pull and has no Run update", () => {
  const html = render({ status: status({ installMode: "local" }) });
  assert.match(
    textOf(html),
    /Update available: v1\.2\.0\. This is a dev checkout\. Pull the latest changes to update\./,
  );
  assert.doesNotMatch(textOf(html), /Run update/);
});

void test("a running update shows the progress copy, a busy disabled button and no dismiss", () => {
  const html = render({ pending: true });
  assert.match(textOf(html), /Running update…/);
  assert.match(textOf(html), /Updating…/);
  assert.doesNotMatch(textOf(html), /Run update/);
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /disabled=""/);
  assert.doesNotMatch(html, /Dismiss update notice/);
});

void test("a successful update shows the version and no Run update", () => {
  const html = render({ result: { ok: true, version: "1.2.0" } });
  assert.equal(textOf(html), "Updated to v1.2.0. Restart dispatch to use it");
  assert.doesNotMatch(html, /<button/);
});

void test("a failed update shows the manual command it returned and keeps Run update", () => {
  const html = render({
    result: { ok: false, command: "sudo npm i -g dispatch" },
  });
  const text = textOf(html);
  assert.match(text, /Couldn't update automatically\. Run it yourself:/);
  assert.match(text, /sudo npm i -g dispatch/);
  assert.match(text, /Run update/);
});

void test("a failed update with an empty command falls back to the default command", () => {
  const html = render({ result: { ok: false, command: "" } });
  assert.match(textOf(html), /npm i -g @theyashgupta\/dispatch@latest/);
});

void test("a thrown error shows the default manual command and keeps Run update", () => {
  const html = render({ failed: true });
  const text = textOf(html);
  assert.match(text, /Couldn't update automatically\. Run it yourself:/);
  assert.match(text, /npm i -g @theyashgupta\/dispatch@latest/);
  assert.match(text, /Run update/);
});
