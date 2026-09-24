import assert from "node:assert/strict";
import { test } from "node:test";
import {
  IDLE_TOAST,
  isToastVisible,
  reduceUndoToast,
  undoToastCopy,
  type UndoToastEntry,
} from "./useUndoToast.js";

const noop = () => Promise.resolve();
const a: UndoToastEntry = { id: 1, label: "Unwound GROUP-7", undo: noop };
const b: UndoToastEntry = { id: 2, label: "Item marked done", undo: noop };

test("show, undo, undone: the toast appears with its label, then clears on a successful undo", () => {
  const shown = reduceUndoToast(IDLE_TOAST, { type: "show", toast: a });
  assert.equal(isToastVisible(shown), true);
  assert.equal(shown.toast?.label, "Unwound GROUP-7");
  const undoing = reduceUndoToast(shown, { type: "undo", id: 1 });
  assert.equal(undoing.undoing, true);
  assert.equal(
    isToastVisible(reduceUndoToast(undoing, { type: "undone", id: 1 })),
    false,
  );
});

test("a failed undo keeps the toast open with the reason, and dismiss always clears", () => {
  const shown = reduceUndoToast(IDLE_TOAST, { type: "show", toast: a });
  const failed = reduceUndoToast(
    reduceUndoToast(shown, { type: "undo", id: 1 }),
    { type: "failed", id: 1, error: "LOCAL-1 moved to inbox" },
  );
  assert.equal(isToastVisible(failed), true);
  assert.equal(failed.undoing, false);
  assert.equal(failed.error, "LOCAL-1 moved to inbox");
  assert.equal(failed.toast?.id, 1, "undo stays offered");
  assert.deepEqual(reduceUndoToast(failed, { type: "dismiss" }), IDLE_TOAST);
});

test("a notice shows a message with no undo, undo on an idle toast is a no-op, and the copy handles singular and Inbox", () => {
  const notice = reduceUndoToast(IDLE_TOAST, {
    type: "notice",
    error: "a start is in flight",
  });
  assert.equal(isToastVisible(notice), true);
  assert.equal(notice.toast, null);
  assert.deepEqual(
    reduceUndoToast(IDLE_TOAST, { type: "undo", id: 1 }),
    IDLE_TOAST,
  );
  assert.equal(
    undoToastCopy({
      id: "GROUP-7",
      identifier: "GROUP-7",
      title: "billing fixes",
      archivedAt: "2026-09-10T00:00:00.000Z",
      destination: "inbox",
      members: [{ id: "LOCAL-1", identifier: "LOCAL-1" }],
    }),
    "Unwound GROUP-7: 1 ticket sent to Inbox",
  );
});

test("a second undo while one is in flight is a no-op", () => {
  const undoing = reduceUndoToast(
    reduceUndoToast(IDLE_TOAST, { type: "show", toast: a }),
    { type: "undo", id: 1 },
  );
  assert.equal(reduceUndoToast(undoing, { type: "undo", id: 1 }), undoing);
});

test("a stale undo outcome for a replaced toast is ignored", () => {
  const shownB = reduceUndoToast(
    reduceUndoToast(reduceUndoToast(IDLE_TOAST, { type: "show", toast: a }), {
      type: "undo",
      id: 1,
    }),
    { type: "show", toast: b },
  );
  assert.equal(shownB.undoing, false);
  assert.deepEqual(
    reduceUndoToast(shownB, { type: "undone", id: 1 }),
    shownB,
    "A's success must not dismiss B",
  );
  assert.deepEqual(
    reduceUndoToast(shownB, { type: "failed", id: 1, error: "x" }),
    shownB,
    "A's failure must not label B",
  );
  assert.deepEqual(
    reduceUndoToast(shownB, { type: "undo", id: 1 }),
    shownB,
    "a stale undo start is a no-op",
  );
});
