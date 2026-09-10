import assert from "node:assert/strict";
import { test } from "node:test";
import type { ArchivedGroupSummary } from "../../shared/types.js";
import {
  IDLE_TOAST,
  isToastVisible,
  reduceUndoToast,
  undoToastCopy,
} from "./useUndoToast.js";

const archived: ArchivedGroupSummary = {
  id: "GROUP-7",
  identifier: "GROUP-7",
  title: "billing fixes",
  archivedAt: "2026-09-10T00:00:00.000Z",
  destination: "todo",
  members: [
    { id: "LOCAL-1", identifier: "LOCAL-1" },
    { id: "LOCAL-2", identifier: "LOCAL-2" },
  ],
};

test("show, undo, undone: the toast appears with the group and count, then clears on a successful undo", () => {
  const shown = reduceUndoToast(IDLE_TOAST, { type: "show", archived });
  assert.equal(isToastVisible(shown), true);
  assert.equal(
    undoToastCopy(archived),
    "Unwound GROUP-7: 2 tickets sent to To Do",
  );
  const undoing = reduceUndoToast(shown, { type: "undo", id: "GROUP-7" });
  assert.equal(undoing.undoing, true);
  assert.equal(
    isToastVisible(reduceUndoToast(undoing, { type: "undone", id: "GROUP-7" })),
    false,
  );
});

test("a failed undo keeps the toast open with the server's reason, and dismiss always clears", () => {
  const shown = reduceUndoToast(IDLE_TOAST, { type: "show", archived });
  const failed = reduceUndoToast(
    reduceUndoToast(shown, { type: "undo", id: "GROUP-7" }),
    {
      type: "failed",
      id: "GROUP-7",
      error: "LOCAL-1 moved to inbox",
    },
  );
  assert.equal(isToastVisible(failed), true);
  assert.equal(failed.undoing, false);
  assert.equal(failed.error, "LOCAL-1 moved to inbox");
  assert.equal(failed.archived?.id, "GROUP-7", "undo stays offered");
  assert.deepEqual(reduceUndoToast(failed, { type: "dismiss" }), IDLE_TOAST);
});

test("a notice shows a message with no undo, undo on an idle toast is a no-op, and the copy handles singular and Inbox", () => {
  const notice = reduceUndoToast(IDLE_TOAST, {
    type: "notice",
    error: "a start is in flight",
  });
  assert.equal(isToastVisible(notice), true);
  assert.equal(notice.archived, null);
  assert.deepEqual(
    reduceUndoToast(IDLE_TOAST, { type: "undo", id: "GROUP-7" }),
    IDLE_TOAST,
  );
  assert.equal(
    undoToastCopy({
      ...archived,
      destination: "inbox",
      members: archived.members.slice(0, 1),
    }),
    "Unwound GROUP-7: 1 ticket sent to Inbox",
  );
});

test("a stale undo outcome for a replaced toast is ignored", () => {
  const later = { ...archived, id: "GROUP-8", identifier: "GROUP-8" };
  const shownB = reduceUndoToast(
    reduceUndoToast(reduceUndoToast(IDLE_TOAST, { type: "show", archived }), {
      type: "undo",
      id: "GROUP-7",
    }),
    { type: "show", archived: later },
  );
  assert.equal(shownB.undoing, false);
  assert.deepEqual(
    reduceUndoToast(shownB, { type: "undone", id: "GROUP-7" }),
    shownB,
    "A's success must not dismiss B",
  );
  assert.deepEqual(
    reduceUndoToast(shownB, { type: "failed", id: "GROUP-7", error: "x" }),
    shownB,
    "A's failure must not label B",
  );
  assert.deepEqual(
    reduceUndoToast(shownB, { type: "undo", id: "GROUP-7" }),
    shownB,
    "a stale undo start is a no-op",
  );
});
