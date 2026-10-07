import test from "node:test";
import assert from "node:assert/strict";
import { panelEscapeAction } from "./panel-escape.js";

const base = {
  key: "Escape",
  defaultPrevented: false,
  dragging: false,
  takeover: false,
  fullscreen: false,
  docked: false,
};

test("an active drag cancels before anything closes", () => {
  assert.equal(
    panelEscapeAction({ ...base, dragging: true, takeover: true }),
    "cancel-drag",
  );
  assert.equal(
    panelEscapeAction({ ...base, dragging: true, fullscreen: true }),
    "cancel-drag",
  );
});

test("the takeover closes through history before fullscreen is read", () => {
  assert.equal(
    panelEscapeAction({ ...base, takeover: true, fullscreen: true }),
    "close-takeover",
  );
});

test("fullscreen exits before the overlay closes", () => {
  assert.equal(
    panelEscapeAction({ ...base, fullscreen: true }),
    "exit-fullscreen",
  );
});

test("the overlay panel closes", () => {
  assert.equal(panelEscapeAction(base), "close-overlay");
});

test("a docked panel ignores Escape", () => {
  assert.equal(panelEscapeAction({ ...base, docked: true }), "ignore");
});

test("another key or an Escape another layer handled does nothing", () => {
  assert.equal(panelEscapeAction({ ...base, key: "Enter" }), "ignore");
  assert.equal(
    panelEscapeAction({ ...base, defaultPrevented: true, dragging: true }),
    "ignore",
  );
});
