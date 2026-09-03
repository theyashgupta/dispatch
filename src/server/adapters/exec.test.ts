import assert from "node:assert/strict";
import { test } from "node:test";
import { run } from "./exec.js";

test("run pipes input to the child's stdin and closes it", async () => {
  const { stdout } = await run("cat", [], { input: "hello stdin\n" });
  assert.equal(stdout, "hello stdin\n");
});

test("run without the input option leaves stdin alone", async () => {
  const { stdout } = await run("cat", ["/dev/null"], {});
  assert.equal(stdout, "");
});

test("run survives a child that exits before draining a large input", async () => {
  await assert.rejects(
    run("sh", ["-c", "exit 3"], { input: "x".repeat(300_000) }),
  );
  const { stdout } = await run("cat", [], { input: "still alive\n" });
  assert.equal(stdout, "still alive\n");
});

test("run with an empty input closes stdin so a reader finishes", async () => {
  const { stdout } = await run("cat", [], { input: "" });
  assert.equal(stdout, "");
});
