import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ClaudeAccountSummary } from "../../../../shared/types.js";
import {
  DEFAULT_USAGE_THRESHOLDS,
  type UsageThresholds,
} from "../../../../shared/usage-thresholds.js";
import { AccountRow } from "./AccountRow.js";

const NOW = 1_700_000_000_000;

function textOf(html: string): string {
  let text = "";
  let inTag = false;
  for (const char of html) {
    if (char === "<") inTag = true;
    else if (char === ">") inTag = false;
    else if (!inTag) text += char;
  }
  return text;
}

function account(
  extra: Partial<ClaudeAccountSummary> = {},
): ClaudeAccountSummary {
  return {
    id: "acct-1",
    email: "dev@example.com",
    orgName: "Example Org",
    subscriptionType: "max",
    isDefault: false,
    usage: { status: "unavailable", windows: [], fetchedAt: null },
    position: 0,
    state: "available",
    buckets: [],
    limitedUntil: null,
    inUse: false,
    ...extra,
  };
}

function render(
  extra: Partial<ClaudeAccountSummary> = {},
  active = false,
  thresholds: UsageThresholds = DEFAULT_USAGE_THRESHOLDS,
): string {
  return renderToStaticMarkup(
    createElement(AccountRow, {
      account: account(extra),
      active,
      now: NOW,
      thresholds,
      reloginDisabled: false,
      onSwitch: () => {},
      onRelogin: () => {},
      onRemove: () => {},
      onRemoveDuplicate: () => {},
    }),
  );
}

void test("a needs-login row shows the badge with Re-login and Switch buttons", () => {
  const text = textOf(render({ state: "needs-login" }));
  assert.match(text, /Needs login/);
  assert.match(text, /Re-login/);
  assert.match(text, /Switch/);
});

void test("a shadowed-by-home row shows the duplicate notice and no Switch or Re-login", () => {
  const html = render({ state: "shadowed-by-home" });
  const text = textOf(html);
  assert.match(text, /Same login as Default/);
  assert.match(text, /Remove duplicate/);
  assert.doesNotMatch(text, /Switch/);
  assert.doesNotMatch(text, /Re-login/);
  assert.doesNotMatch(html, /aria-label="Switch to/);
});

void test("a managed default row names the Dispatch login", () => {
  const text = textOf(render({ isDefault: true, managedDefault: true }));
  assert.match(text, /Default \(Dispatch login\)/);
});

void test("an available, non-active row shows no login warnings", () => {
  const text = textOf(render({ state: "available" }));
  assert.doesNotMatch(text, /Needs login/);
  assert.doesNotMatch(text, /Same login as Default/);
});

void test("an active row shows Active and no Switch button", () => {
  const html = render({}, true);
  const text = textOf(html);
  assert.match(text, /Active/);
  assert.doesNotMatch(text, /Switch/);
  assert.doesNotMatch(html, /aria-label="Switch to/);
});

void test("the usage dot takes its tone from the thresholds", () => {
  const usage: ClaudeAccountSummary["usage"] = {
    status: "ok",
    fetchedAt: null,
    windows: [
      {
        kind: "session",
        label: "Session",
        percent: 65,
        resetsAt: null,
        isActive: true,
        periodStart: null,
        periodEnd: null,
      },
    ],
  };
  const custom = {
    ...DEFAULT_USAGE_THRESHOLDS,
    warningPercent: 60,
    criticalPercent: 80,
  };
  assert.match(render({ usage }), /data-tone="ok"/);
  assert.match(render({ usage }, false, custom), /data-tone="stale"/);
});
