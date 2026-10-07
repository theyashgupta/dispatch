import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  IDLE_TOAST,
  reduceUndoToast,
  undoToastView,
  type UndoToastState,
} from "./undo-toast.js";

const entry = { id: 1, label: "Unwound LOCAL-1", undo: async () => {} };
const shown: UndoToastState = reduceUndoToast(IDLE_TOAST, {
  type: "show",
  toast: entry,
});

describe("undoToastView", () => {
  it("offers Undo for a toast", () => {
    assert.deepEqual(undoToastView(shown), {
      label: "Unwound LOCAL-1",
      description: undefined,
      undoable: true,
    });
  });

  it("shows a notice as a label with no Undo", () => {
    const state = reduceUndoToast(IDLE_TOAST, {
      type: "notice",
      error: "Couldn't start the agent.",
    });
    assert.deepEqual(undoToastView(state), {
      label: "Couldn't start the agent.",
      description: undefined,
      undoable: false,
    });
  });

  it("puts the failure text of a toast in the description", () => {
    const state = reduceUndoToast(shown, {
      type: "failed",
      id: 1,
      error: "Couldn't undo.",
    });
    assert.deepEqual(undoToastView(state), {
      label: "Unwound LOCAL-1",
      description: "Couldn't undo.",
      undoable: true,
    });
  });

  it("maps idle to null so the effect dismisses", () => {
    assert.equal(undoToastView(IDLE_TOAST), null);
  });
});

describe("reduceUndoToast", () => {
  const failed = reduceUndoToast(shown, {
    type: "failed",
    id: 1,
    error: "Couldn't undo.",
  });
  const next = { id: 2, label: "Unwound LOCAL-2", undo: async () => {} };

  it("replaces a failed undo when a new toast is shown", () => {
    const state = reduceUndoToast(failed, { type: "show", toast: next });
    assert.deepEqual(state, { toast: next, undoing: false, error: null });
  });

  it("replaces a showing toast with a notice", () => {
    const state = reduceUndoToast(shown, {
      type: "notice",
      error: "Couldn't start the agent.",
    });
    assert.deepEqual(state, {
      toast: null,
      undoing: false,
      error: "Couldn't start the agent.",
    });
  });

  it("ignores an undone for a stale id", () => {
    const state = reduceUndoToast(shown, { type: "undone", id: 99 });
    assert.equal(state, shown);
  });

  it("ignores a second undo while one is in flight", () => {
    const undoing = reduceUndoToast(shown, { type: "undo", id: 1 });
    assert.equal(undoing.undoing, true);
    assert.equal(reduceUndoToast(undoing, { type: "undo", id: 1 }), undoing);
  });
});
