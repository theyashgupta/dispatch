import assert from "node:assert/strict";
import { test } from "node:test";
import type { Playbook } from "../../../../shared/types.js";
import {
  filterPlaybooksByTag,
  initialPlaybook,
  noTaggedPlaybookText,
  orderSeedRows,
  resolvePlaybook,
  splitPlaybooks,
} from "./playbook-picker.js";

const pb = (name: string, slug?: string): Playbook => ({
  name,
  body: "",
  slug,
});

const roadmap = pb("Roadmap Loop", "roadmap-loop");
const gsd = pb("GSD", "gsd");
const ralph = pb("PRD + Ralph Loop", "prd-ralph-loop");
const direct = pb("Write code directly", "write-code-directly");
const custom = pb("Custom", "custom");

test("seed rows follow the fixed seed order, not the input order", () => {
  assert.deepEqual(orderSeedRows([direct, custom, gsd, ralph]), [
    ralph,
    gsd,
    direct,
  ]);
});

test("roadmap-loop is the second seed row", () => {
  assert.deepEqual(orderSeedRows([direct, gsd, roadmap, custom, ralph]), [
    ralph,
    roadmap,
    gsd,
    direct,
  ]);
});

test("seed rows skip a seed that is missing", () => {
  assert.deepEqual(orderSeedRows([gsd]), [gsd]);
});

test("a playbook without a slug is never a seed row", () => {
  assert.deepEqual(orderSeedRows([pb("No slug")]), []);
});

test("the rest rows keep the input order after the seed rows", () => {
  const other = pb("Other", "other");
  assert.deepEqual(splitPlaybooks([custom, gsd, other]), {
    seedRows: [gsd],
    restRows: [custom, other],
  });
});

test("the remembered default is selected first", () => {
  assert.equal(initialPlaybook([gsd, direct, custom], "Custom"), "Custom");
});

test("write code directly is selected when the remembered default is gone", () => {
  assert.equal(
    initialPlaybook([gsd, direct, custom], "Deleted"),
    "Write code directly",
  );
});

test("the first row in picker order is selected without a default", () => {
  assert.equal(initialPlaybook([custom, gsd], null), "GSD");
  assert.equal(initialPlaybook([custom], null), "Custom");
});

test("nothing is selected without a valid playbook", () => {
  assert.equal(initialPlaybook([], "Custom"), null);
});

test("a chosen playbook stays selected while it is valid", () => {
  assert.equal(resolvePlaybook([gsd, custom], null, "Custom"), "Custom");
});

test("a chosen playbook that is no longer valid falls back to the initial one", () => {
  assert.equal(resolvePlaybook([gsd, custom], null, "Deleted"), "GSD");
});

const review = { ...pb("Review a pull request", "review"), tags: ["review"] };
const other = { ...pb("Other", "other"), tags: ["docs", "review-later"] };

test("the tag filter lists only playbooks that carry the tag", () => {
  assert.deepEqual(filterPlaybooksByTag([direct, review, other], "review"), [
    review,
  ]);
  assert.deepEqual(filterPlaybooksByTag([direct, other], "review"), []);
});

test("without a tag the filter keeps every playbook", () => {
  assert.deepEqual(filterPlaybooksByTag([direct, review], undefined), [
    direct,
    review,
  ]);
});

test("the requested playbook is preselected when listed", () => {
  assert.equal(
    initialPlaybook([direct, review], "Write code directly", review.name),
    review.name,
  );
  assert.equal(
    resolvePlaybook([direct, review], null, null, review.name),
    review.name,
  );
});

test("an unlisted requested playbook falls back to the default", () => {
  assert.equal(
    initialPlaybook([direct, custom], "Custom", "Review a pull request"),
    "Custom",
  );
  assert.equal(
    resolvePlaybook([direct, custom], null, null, "Review a pull request"),
    "Write code directly",
  );
});

test("a chosen playbook still wins over the requested one", () => {
  assert.equal(
    resolvePlaybook([direct, review], null, "Write code directly", review.name),
    "Write code directly",
  );
});

test("a remembered review playbook is not preselected without a request", () => {
  assert.equal(
    initialPlaybook([direct, review], review.name),
    "Write code directly",
  );
  assert.equal(
    resolvePlaybook([direct, review], review.name, null),
    "Write code directly",
  );
});

test("a requested review playbook is preselected over the remembered one", () => {
  assert.equal(
    initialPlaybook([direct, review], review.name, "Review a pull request"),
    review.name,
  );
});

test("a remembered playbook without the review tag still wins", () => {
  assert.equal(initialPlaybook([direct, review, custom], "Custom"), "Custom");
});

test("the empty text names the tag", () => {
  assert.equal(
    noTaggedPlaybookText("review"),
    "No playbook has the tag review.",
  );
});
