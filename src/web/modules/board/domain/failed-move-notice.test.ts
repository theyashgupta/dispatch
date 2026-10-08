import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AUTO_DISMISS_MS,
  failedMoveReducer,
  noticeLabel,
  shouldAutoDismiss,
  type FailedMoveNotice,
} from "./failed-move-notice.js";

const notice = (extra: Partial<FailedMoveNotice> = {}): FailedMoveNotice => ({
  id: 2,
  count: 3,
  settled: false,
  stranded: false,
  ...extra,
});

test("the label is singular for one ticket and plural otherwise", () => {
  assert.equal(noticeLabel(1), "Couldn't move 1 ticket");
  assert.equal(noticeLabel(2), "Couldn't move 2 tickets");
  assert.equal(noticeLabel(3), "Couldn't move 3 tickets");
});

test("the auto dismiss delay is 3200 ms", () => {
  assert.equal(AUTO_DISMISS_MS, 3200);
});

test("failed opens an unsettled, unstranded notice and replaces any current one", () => {
  assert.deepEqual(
    failedMoveReducer(null, { type: "failed", id: 2, count: 3 }),
    notice(),
  );
  assert.deepEqual(
    failedMoveReducer(notice({ id: 1, stranded: true, settled: true }), {
      type: "failed",
      id: 2,
      count: 3,
    }),
    notice(),
  );
});

test("stranded marks the current notice and ignores a stale id", () => {
  assert.deepEqual(
    failedMoveReducer(notice(), { type: "stranded", id: 2 }),
    notice({ stranded: true }),
  );
  const current = notice();
  assert.equal(
    failedMoveReducer(current, { type: "stranded", id: 1 }),
    current,
  );
  assert.equal(failedMoveReducer(null, { type: "stranded", id: 2 }), null);
});

test("settled marks the current notice and ignores a stale id", () => {
  assert.deepEqual(
    failedMoveReducer(notice(), { type: "settled", id: 2 }),
    notice({ settled: true }),
  );
  const current = notice();
  assert.equal(failedMoveReducer(current, { type: "settled", id: 1 }), current);
  assert.equal(failedMoveReducer(null, { type: "settled", id: 2 }), null);
});

test("dismissed clears the current notice and ignores a stale id", () => {
  assert.equal(failedMoveReducer(notice(), { type: "dismissed", id: 2 }), null);
  const current = notice();
  assert.equal(
    failedMoveReducer(current, { type: "dismissed", id: 1 }),
    current,
  );
});

test("succeeded clears any notice", () => {
  assert.equal(failedMoveReducer(notice(), { type: "succeeded" }), null);
  assert.equal(failedMoveReducer(null, { type: "succeeded" }), null);
});

test("only a settled notice with no stranded card dismisses itself", () => {
  assert.equal(shouldAutoDismiss(notice({ settled: true })), true);
  assert.equal(shouldAutoDismiss(notice()), false);
  assert.equal(
    shouldAutoDismiss(notice({ settled: true, stranded: true })),
    false,
  );
  assert.equal(shouldAutoDismiss(notice({ stranded: true })), false);
  assert.equal(shouldAutoDismiss(null), false);
});
