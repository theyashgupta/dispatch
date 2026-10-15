import test from "node:test";
import assert from "node:assert/strict";
import { sidePanelEscapeAction } from "./side-panel-escape.js";

const base = {
  key: "Escape",
  defaultPrevented: false,
  dragging: false,
  docked: false,
  coveredByOverlay: false,
};

test("an active drag cancels before anything closes", () => {
  assert.equal(
    sidePanelEscapeAction({ ...base, dragging: true }),
    "cancel-drag",
  );
  assert.equal(
    sidePanelEscapeAction({ ...base, dragging: true, docked: true }),
    "cancel-drag",
  );
});

test("expanded and side mode both close, because expanded is not an input", () => {
  assert.equal(sidePanelEscapeAction(base), "close");
});

test("a docked panel ignores Escape", () => {
  assert.equal(sidePanelEscapeAction({ ...base, docked: true }), "ignore");
});

test("another key does nothing", () => {
  assert.equal(sidePanelEscapeAction({ ...base, key: "Enter" }), "ignore");
  assert.equal(
    sidePanelEscapeAction({ ...base, key: "Enter", dragging: true }),
    "ignore",
  );
});

test("an Escape another layer handled does nothing, even during a drag", () => {
  assert.equal(
    sidePanelEscapeAction({ ...base, defaultPrevented: true }),
    "ignore",
  );
  assert.equal(
    sidePanelEscapeAction({ ...base, defaultPrevented: true, dragging: true }),
    "ignore",
  );
});

test("an inline panel under an open overlay panel ignores Escape, so only the top panel closes", () => {
  assert.equal(
    sidePanelEscapeAction({ ...base, coveredByOverlay: true }),
    "ignore",
  );
  assert.equal(
    sidePanelEscapeAction({ ...base, coveredByOverlay: true, dragging: true }),
    "cancel-drag",
  );
});
