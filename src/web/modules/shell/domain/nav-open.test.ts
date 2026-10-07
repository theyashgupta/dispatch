import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CAROUSEL_MAX_WIDTH,
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

test("the carousel width matches the legacy CAROUSEL_QUERY media query text", () => {
  const source = readFileSync(
    new URL("../../../../shared/media-queries.ts", import.meta.url),
    "utf8",
  );
  assert.ok(
    source.includes(
      `export const CAROUSEL_QUERY = "(max-width: ${CAROUSEL_MAX_WIDTH}px)";`,
    ),
  );
});

test("the carousel width matches the CAROUSEL_QUERY the modules import", () => {
  const source = readFileSync(
    new URL("../../../components/ui/hooks/use-media-query.ts", import.meta.url),
    "utf8",
  );
  assert.ok(
    source.includes(
      `export const CAROUSEL_QUERY = "(max-width: ${CAROUSEL_MAX_WIDTH}px)";`,
    ),
  );
});

test("the generated phone breakpoint and the legacy NARROW_QUERY switch at the same width", () => {
  const read = (path: string) =>
    readFileSync(new URL(path, import.meta.url), "utf8");
  const mobile = read("../../../components/ui/hooks/use-mobile.ts").match(
    /const MOBILE_BREAKPOINT = (\d+);/,
  );
  const narrow = read("../../../../shared/media-queries.ts").match(
    /export const NARROW_QUERY = "\(max-width: (\d+)px\)";/,
  );
  assert.ok(mobile && narrow);
  assert.equal(Number(mobile[1]) - 1, Number(narrow[1]));
});
