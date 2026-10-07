import assert from "node:assert/strict";
import test from "node:test";
import { parseSeedArgs } from "../tests/visual/seed-args.mjs";

const env = { DISPATCH_VISUAL_NOW: "2026-10-01T12:00:00.000Z" };

void test("a valid seeded or fresh call returns its kind, port and time", () => {
  assert.deepEqual(parseSeedArgs(["seeded", "48471"], env), {
    kind: "seeded",
    port: 48471,
    now: Date.parse("2026-10-01T12:00:00.000Z"),
  });
  assert.equal(parseSeedArgs(["fresh", "48401"], env).kind, "fresh");
});

void test("an unknown or missing kind throws the usage message", () => {
  for (const argv of [["other", "48471"], [], ["48471"]])
    assert.throws(
      () => parseSeedArgs(argv, env),
      /^Error: usage: node tests\/visual\/seed\.mjs/,
    );
});

void test("a port at or below 48400, including every live service port, or a non-integer port throws", () => {
  for (const port of [
    "48400",
    "48399",
    "4700",
    "4710",
    "47990",
    "5291",
    "48471.5",
    "abc",
    "",
  ])
    assert.throws(
      () => parseSeedArgs(["seeded", port], env),
      new Error(`port ${port} not allowed, use a free port above 48400`),
      port,
    );
  assert.throws(
    () => parseSeedArgs(["seeded"], env),
    new Error("port undefined not allowed, use a free port above 48400"),
  );
});

void test("a missing or unparsable DISPATCH_VISUAL_NOW throws", () => {
  for (const value of [undefined, "", "not a time"])
    assert.throws(
      () => parseSeedArgs(["seeded", "48471"], { DISPATCH_VISUAL_NOW: value }),
      new Error("DISPATCH_VISUAL_NOW must be an ISO time"),
    );
});
