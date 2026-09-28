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

test("a timeout escalates to SIGKILL for a child that ignores SIGTERM", async () => {
  const started = Date.now();
  await assert.rejects(
    run("sh", ["-c", "trap '' TERM; exec sleep 30"], {
      timeout: 500,
      killEscalationMs: 500,
    }),
    (err: unknown) => (err as { killed?: boolean }).killed === true,
  );
  assert.ok(Date.now() - started < 10_000, "the child outlived the escalation");
});

test("an already aborted signal rejects at once and leaves no child", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    run("sleep", ["31.7"], {
      signal: controller.signal,
      killEscalationMs: 200,
    }),
    (err: unknown) => (err as { code?: string }).code === "ABORT_ERR",
  );
  await new Promise((r) => setTimeout(r, 500));
  const { stdout } = await run("sh", [
    "-c",
    "pgrep -f '[s]leep 31[.]7' || true",
  ]);
  assert.equal(stdout.trim(), "");
});
