import test from "node:test";
import assert from "node:assert/strict";
import { cn } from "./utils.js";

test("cn joins class names in order", () => {
  assert.equal(cn("flex", "items-center"), "flex items-center");
});

test("cn keeps the later class of one Tailwind group", () => {
  assert.equal(cn("p-2", "p-4"), "p-4");
  assert.equal(cn("px-2 py-1", "p-3"), "p-3");
  assert.equal(
    cn("text-muted-foreground", "text-foreground"),
    "text-foreground",
  );
});

test("cn drops falsy inputs and reads objects and arrays", () => {
  assert.equal(cn("a", false, null, undefined, 0, "", "b"), "a b");
  assert.equal(
    cn({ hidden: false, block: true }, ["gap-2", ["gap-4"]]),
    "block gap-4",
  );
});

test("cn keeps class names Tailwind does not know", () => {
  assert.equal(cn("scroll-stable-y", "md-body"), "scroll-stable-y md-body");
});
