import assert from "node:assert/strict";
import { test } from "node:test";
import type { Playbook } from "../../../../shared/types.js";
import {
  initialPlaybook,
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
