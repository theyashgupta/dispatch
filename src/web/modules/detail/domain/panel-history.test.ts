import test from "node:test";
import assert from "node:assert/strict";
import {
  INITIAL_PANEL_HISTORY,
  panelHistoryLeft,
  panelHistoryPopped,
  panelHistoryPushed,
} from "./panel-history.js";

test("a user back on the pushed entry closes the panel once", () => {
  const pushed = panelHistoryPushed(INITIAL_PANEL_HISTORY);
  const first = panelHistoryPopped(pushed);
  assert.equal(first.close, true);
  assert.deepEqual(first.state, { pushed: false, pendingBack: 0 });
  assert.equal(panelHistoryPopped(first.state).close, false);
});

test("the back the panel causes is ignored by the counter", () => {
  const pushed = panelHistoryPushed(INITIAL_PANEL_HISTORY);
  const left = panelHistoryLeft(pushed);
  assert.equal(left.back, true);
  assert.deepEqual(left.state, { pushed: false, pendingBack: 1 });
  const echo = panelHistoryPopped(left.state);
  assert.equal(echo.close, false);
  assert.deepEqual(echo.state, { pushed: false, pendingBack: 0 });
});

test("a card switch in takeover keeps the new card open", () => {
  const left = panelHistoryLeft(panelHistoryPushed(INITIAL_PANEL_HISTORY));
  const repushed = panelHistoryPushed(left.state);
  const echo = panelHistoryPopped(repushed);
  assert.equal(echo.close, false);
  assert.deepEqual(echo.state, { pushed: true, pendingBack: 0 });
  assert.equal(panelHistoryPopped(echo.state).close, true);
});

test("leaving without a pushed entry calls no back", () => {
  const left = panelHistoryLeft(INITIAL_PANEL_HISTORY);
  assert.equal(left.back, false);
  assert.deepEqual(left.state, INITIAL_PANEL_HISTORY);
});

test("a popstate with no pushed entry and no pending back does nothing", () => {
  const popped = panelHistoryPopped(INITIAL_PANEL_HISTORY);
  assert.equal(popped.close, false);
  assert.deepEqual(popped.state, INITIAL_PANEL_HISTORY);
});
