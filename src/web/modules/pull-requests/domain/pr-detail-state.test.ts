import assert from "node:assert/strict";
import { test } from "node:test";
import type { PrDetail } from "../../../../shared/types.js";
import {
  patchLineKind,
  prStateBadge,
  reviewNotice,
} from "./pr-detail-state.js";

function detail(state: PrDetail["state"], draft: boolean): PrDetail {
  return { state, draft } as PrDetail;
}

test("the state badge reads merged, closed, draft and open", () => {
  assert.deepEqual(prStateBadge(detail("merged", false)), {
    tone: "success",
    label: "Merged",
  });
  assert.deepEqual(prStateBadge(detail("closed", true)), {
    tone: "danger",
    label: "Closed",
  });
  assert.deepEqual(prStateBadge(detail("open", true)), {
    tone: "neutral",
    label: "Draft",
  });
  assert.deepEqual(prStateBadge(detail("open", false)), {
    tone: "neutral",
    label: "Open",
  });
});

test("patch lines classify by their first characters", () => {
  assert.equal(patchLineKind("+added"), "add");
  assert.equal(patchLineKind("-removed"), "remove");
  assert.equal(patchLineKind("@@ -1 +1 @@"), "hunk");
  assert.equal(patchLineKind(" same"), "context");
  assert.equal(patchLineKind(""), "context");
});

test("review notices match the page copy", () => {
  assert.equal(reviewNotice("APPROVE", "a/b#1"), "Approved a/b#1.");
  assert.equal(
    reviewNotice("REQUEST_CHANGES", "a/b#1"),
    "Requested changes on a/b#1.",
  );
  assert.equal(reviewNotice("COMMENT", "a/b#1"), "Commented on a/b#1.");
});
