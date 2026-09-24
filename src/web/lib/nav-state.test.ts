import { test } from "node:test";
import assert from "node:assert/strict";
import { effectiveNavState } from "./nav-state.js";

test("narrow always yields the top bar, whatever is stored", () => {
  assert.equal(effectiveNavState("expanded", true, true), "topbar");
  assert.equal(effectiveNavState("collapsed", false, true), "topbar");
});

test("the carousel breakpoint forces collapsed even when expanded is stored", () => {
  assert.equal(effectiveNavState("expanded", true, false), "collapsed");
  assert.equal(effectiveNavState("collapsed", true, false), "collapsed");
});

test("wide viewports follow the stored preference", () => {
  assert.equal(effectiveNavState("expanded", false, false), "expanded");
  assert.equal(effectiveNavState("collapsed", false, false), "collapsed");
});
