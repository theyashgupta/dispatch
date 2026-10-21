import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ClaudeAccountSummary } from "../../../../shared/types.js";
import { AccountsList } from "./AccountsList.js";

const NOW = 1_700_000_000_000;

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
  props: {
    accounts?: ClaudeAccountSummary[];
    activeId?: string;
    managedDefaultOffer?: boolean;
  } = {},
): string {
  return renderToStaticMarkup(
    createElement(AccountsList, {
      accounts: [account()],
      activeId: "acct-1",
      now: NOW,
      loaded: true,
      failed: false,
      removeError: null,
      addDisabled: false,
      managedDefaultOffer: false,
      onAdd: () => {},
      onManagedLogin: () => {},
      onSwitch: () => {},
      onRelogin: () => {},
      onRemove: () => {},
      onRemoveDuplicate: () => {},
      reloginDisabled: false,
      ...props,
    }),
  );
}

void test("the list renders one row per account in the given order", () => {
  const html = render({
    accounts: [
      account({ id: "acct-c", email: "c@example.com" }),
      account({ id: "acct-a", email: "a@example.com" }),
      account({ id: "acct-b", email: "b@example.com" }),
    ],
  });
  const c = html.indexOf('data-account-id="acct-c"');
  const a = html.indexOf('data-account-id="acct-a"');
  const b = html.indexOf('data-account-id="acct-b"');
  assert.ok(c >= 0 && a >= 0 && b >= 0);
  assert.ok(c < a && a < b);
  assert.equal(html.split("data-account-id=").length - 1, 3);
});

void test("the managed default offer renders when the offer flag is true", () => {
  const html = render({ managedDefaultOffer: true });
  assert.match(html, /data-testid="managed-default-offer"/);
  assert.match(html, /Move the Default account to a Dispatch login/);
});

void test("the managed default offer is absent when the offer flag is false", () => {
  const html = render({ managedDefaultOffer: false });
  assert.doesNotMatch(html, /data-testid="managed-default-offer"/);
  assert.doesNotMatch(html, /Move the Default account to a Dispatch login/);
});
