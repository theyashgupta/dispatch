import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MARKER_ERROR,
  checkedDrafts,
  createErrorCopy,
  draftErrorCopy,
  hasBlankCheckedTitle,
  toReviewRows,
  type MeetingDraft,
} from "./draft-rows.js";

const drafts: MeetingDraft[] = [
  { key: "a", title: "Send the deck", description: "da" },
  { key: "b", title: "Book the room", description: "db" },
  { key: "c", title: "Email Ana", description: "dc" },
];

test("toReviewRows checks every draft and keeps its title", () => {
  assert.deepEqual(
    toReviewRows(drafts).map((r) => [r.draft.key, r.checked, r.title]),
    [
      ["a", true, "Send the deck"],
      ["b", true, "Book the room"],
      ["c", true, "Email Ana"],
    ],
  );
});

test("checkedDrafts leaves an unchecked draft out of the create request", () => {
  const rows = toReviewRows(drafts);
  rows[1] = { ...rows[1], checked: false };
  assert.deepEqual(
    checkedDrafts(rows).map((d) => d.key),
    ["a", "c"],
  );
});

test("checkedDrafts sends the edited title trimmed and keeps the description", () => {
  const rows = toReviewRows(drafts);
  rows[0] = { ...rows[0], title: "  Send the new deck  " };
  assert.deepEqual(checkedDrafts(rows)[0], {
    key: "a",
    title: "Send the new deck",
    description: "da",
  });
});

test("checkedDrafts is empty when every row is unchecked", () => {
  const rows = toReviewRows(drafts).map((r) => ({ ...r, checked: false }));
  assert.deepEqual(checkedDrafts(rows), []);
});

test("hasBlankCheckedTitle ignores a blank title on an unchecked row", () => {
  const rows = toReviewRows(drafts);
  rows[0] = { ...rows[0], title: "   ", checked: false };
  assert.equal(hasBlankCheckedTitle(rows), false);
  rows[0] = { ...rows[0], checked: true };
  assert.equal(hasBlankCheckedTitle(rows), true);
});

test("draftErrorCopy maps the busy code, an invalid code and anything else", () => {
  assert.equal(
    draftErrorCopy("generate-in-progress"),
    "Another draft is still running or stopping. Try again in a few seconds.",
  );
  assert.equal(
    draftErrorCopy("invalid-notes"),
    "Check the meeting name and notes, then try again.",
  );
  assert.equal(draftErrorCopy(null), "Couldn't draft action items. Try again.");
  assert.equal(
    draftErrorCopy("boom"),
    "Couldn't draft action items. Try again.",
  );
});

test("createErrorCopy names the reserved marker and falls back to the generic copy", () => {
  assert.equal(
    createErrorCopy(MARKER_ERROR),
    "An item contains the reserved DISPATCH_STATUS marker. Edit its title.",
  );
  assert.equal(createErrorCopy(null), "Couldn't create the items. Try again.");
});
