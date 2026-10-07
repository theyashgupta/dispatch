import test from "node:test";
import assert from "node:assert/strict";
import {
  clampPanelWidth,
  isTapGesture,
  keyboardStepWidth,
  persistedWidthCss,
  startsResizeDrag,
} from "./panel-width.js";

test("the clamp refuses a width below 360 px or above 90 percent of the viewport", () => {
  assert.equal(clampPanelWidth(200, 1440), 360);
  assert.equal(clampPanelWidth(500, 1440), 500);
  assert.equal(clampPanelWidth(1400, 1440), 1296);
});

test("on a viewport under 400 px the 90 percent maximum wins", () => {
  assert.equal(clampPanelWidth(500, 390), 351);
});

test("ArrowLeft widens and ArrowRight narrows by 16 px within the clamp", () => {
  assert.equal(keyboardStepWidth("ArrowLeft", 480, 1440), 496);
  assert.equal(keyboardStepWidth("ArrowRight", 480, 1440), 464);
  assert.equal(keyboardStepWidth("ArrowRight", 370, 1440), 360);
  assert.equal(keyboardStepWidth("ArrowLeft", 1290, 1440), 1296);
});

test("a mouse drag of 3 px or less is a tap", () => {
  assert.equal(isTapGesture(3, "mouse"), true);
  assert.equal(isTapGesture(-3, "mouse"), true);
  assert.equal(isTapGesture(4, "mouse"), false);
});

test("a touch or pen drag of 8 px or less is a tap", () => {
  assert.equal(isTapGesture(8, "touch"), true);
  assert.equal(isTapGesture(-8, "pen"), true);
  assert.equal(isTapGesture(9, "touch"), false);
});

test("only the primary button starts a drag", () => {
  assert.equal(startsResizeDrag(0), true);
  assert.equal(startsResizeDrag(1), false);
  assert.equal(startsResizeDrag(2), false);
});

test("a persisted width becomes the legacy clamp expression", () => {
  assert.equal(persistedWidthCss(520), "clamp(360px, 520px, 90vw)");
});
