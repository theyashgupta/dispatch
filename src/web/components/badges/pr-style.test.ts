import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
} from "lucide-react";
import type { PrInfo } from "../../../shared/types.js";
import {
  prCiDotClass,
  prCiDotColor,
  prStateLabel,
  prStyleFor,
} from "./pr-style.js";

function pr(extra: Partial<PrInfo> = {}): PrInfo {
  return {
    number: 1,
    url: "https://github.com/acme/api/pull/1",
    title: "Add thing",
    state: "open",
    isDraft: false,
    ci: null,
    repo: "api",
    ...extra,
  };
}

test("a draft PR gets the draft icon and the muted outline class", () => {
  assert.deepEqual(prStyleFor(pr({ isDraft: true })), {
    icon: GitPullRequestDraft,
    color: "var(--text-muted)",
    className: "border-border bg-transparent text-muted-foreground",
  });
});

test("a draft stays a draft whatever its state", () => {
  assert.equal(
    prStyleFor(pr({ isDraft: true, state: "merged" })).icon,
    GitPullRequestDraft,
  );
});

test("an open PR gets the pull request icon and the ok tint", () => {
  assert.deepEqual(prStyleFor(pr()), {
    icon: GitPullRequest,
    color: "var(--status-ok)",
    className:
      "border-0 bg-[color-mix(in_srgb,var(--status-ok)_16%,var(--surface-card))] text-(--status-ok)",
  });
});

test("a merged PR gets the merge icon and the in-review tint", () => {
  assert.deepEqual(prStyleFor(pr({ state: "merged" })), {
    icon: GitMerge,
    color: "color-mix(in srgb, var(--col-in-review) 35%, var(--text))",
    className:
      "border-0 bg-[color-mix(in_srgb,var(--col-in-review)_16%,var(--surface-card))] text-[color-mix(in_srgb,var(--col-in-review)_35%,var(--text))]",
  });
});

test("a closed PR gets the closed icon and the done tint", () => {
  assert.deepEqual(prStyleFor(pr({ state: "closed" })), {
    icon: GitPullRequestClosed,
    color: "color-mix(in srgb, var(--col-done) 35%, var(--text))",
    className:
      "border-0 bg-[color-mix(in_srgb,var(--col-done)_16%,var(--surface-card))] text-[color-mix(in_srgb,var(--col-done)_35%,var(--text))]",
  });
});

test("the state label names each state and a draft wins", () => {
  assert.equal(prStateLabel(pr({ isDraft: true })), "Draft");
  assert.equal(prStateLabel(pr({ isDraft: true, state: "merged" })), "Draft");
  assert.equal(prStateLabel(pr()), "Open");
  assert.equal(prStateLabel(pr({ state: "merged" })), "Merged");
  assert.equal(prStateLabel(pr({ state: "closed" })), "Closed");
});

test("the CI dot class and colour agree on every branch", () => {
  const cases: [PrInfo["ci"], string, string][] = [
    ["pass", "bg-(--status-ok)", "var(--status-ok)"],
    ["fail", "bg-destructive", "var(--destructive)"],
    ["pending", "bg-(--status-stale)", "var(--status-stale)"],
    [null, "bg-(--status-ok)", "var(--status-ok)"],
  ];
  for (const [ci, className, color] of cases) {
    assert.equal(prCiDotClass(ci), className, String(ci));
    assert.equal(prCiDotColor(ci), color, String(ci));
  }
});
