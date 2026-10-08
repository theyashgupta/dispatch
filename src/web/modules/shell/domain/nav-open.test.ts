import { test } from "node:test";
import assert from "node:assert/strict";
import { CAROUSEL_MAX_WIDTH } from "../../../../shared/media-queries.js";
import {
  parseNavPreference,
  sidebarOpen,
  viewportNav,
  type NavPreference,
} from "./nav-open.js";

const STORED: NavPreference[] = ["expanded", "collapsed"];

test("at 1440 the stored choice decides and the viewport is not a carousel", () => {
  const { carousel } = viewportNav(1440);
  assert.equal(carousel, false);
  assert.equal(sidebarOpen("expanded", carousel), true);
  assert.equal(sidebarOpen("collapsed", carousel), false);
});

test("at 1024 the stored choice still decides", () => {
  const { carousel } = viewportNav(1024);
  assert.equal(carousel, false);
  assert.equal(sidebarOpen("expanded", carousel), true);
  assert.equal(sidebarOpen("collapsed", carousel), false);
});

test("at 1023 the carousel forces the sidebar closed whatever is stored", () => {
  const { carousel } = viewportNav(1023);
  assert.equal(carousel, true);
  for (const stored of STORED)
    assert.equal(sidebarOpen(stored, carousel), false);
});

test("at 390 the viewport is a carousel and the sidebar is forced closed", () => {
  const { carousel } = viewportNav(390);
  assert.equal(carousel, true);
  for (const stored of STORED)
    assert.equal(sidebarOpen(stored, carousel), false);
});

test("parseNavPreference reads collapsed only for the exact string", () => {
  assert.equal(parseNavPreference("collapsed"), "collapsed");
  assert.equal(parseNavPreference("expanded"), "expanded");
  assert.equal(parseNavPreference(null), "expanded");
  assert.equal(parseNavPreference(""), "expanded");
  assert.equal(parseNavPreference("Collapsed"), "expanded");
});

test("767 and 768 are carousel widths, as the phone breakpoint sits inside the carousel band", () => {
  assert.equal(viewportNav(767).carousel, true);
  assert.equal(viewportNav(768).carousel, true);
});

test("the carousel band ends at the shared CAROUSEL_MAX_WIDTH", () => {
  assert.equal(viewportNav(CAROUSEL_MAX_WIDTH).carousel, true);
  assert.equal(viewportNav(CAROUSEL_MAX_WIDTH + 1).carousel, false);
});
