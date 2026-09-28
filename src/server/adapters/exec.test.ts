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

test("an aborted run with escalation settles only after a SIGTERM-ignoring child is killed", async () => {
  const controller = new AbortController();
  const started = Date.now();
  const pending = run("sh", ["-c", 'trap "" TERM; echo $$; sleep 30'], {
    signal: controller.signal,
    killEscalationMs: 300,
  });
  setTimeout(() => controller.abort(), 100);
  const error = (await pending.catch((err: unknown) => err)) as Error;
  assert.ok(error instanceof Error);
  assert.ok(Date.now() - started >= 350, "settled before the SIGKILL grace");
});

test("a run started with an already-aborted signal settles quickly even for a SIGTERM-ignoring child", async () => {
  const controller = new AbortController();
  controller.abort();
  const started = Date.now();
  const error = await run("sh", ["-c", 'trap "" TERM; sleep 30'], {
    signal: controller.signal,
    killEscalationMs: 300,
  }).catch((err: unknown) => err);
  assert.ok(error instanceof Error);
  assert.ok(Date.now() - started < 2000, "an aborted spawn lingered");
});

test("a run killed by its timeout rejects with killed set", async () => {
  const killedOf = (p: Promise<unknown>) =>
    p.then(
      () => undefined,
      (e: { killed?: boolean }) => e.killed,
    );
  assert.equal(await killedOf(run("sleep", ["5"], { timeout: 100 })), true);
  assert.equal(await killedOf(run("sh", ["-c", "exit 3"], {})), false);
});
