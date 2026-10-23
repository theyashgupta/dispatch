import test from "node:test";
import assert from "node:assert/strict";
import { isolateTmuxEnv } from "../../test-support/fixtures.js";
import { DEFAULT_BOARD_KEY } from "../../../shared/board-key.js";
import type { Config } from "../../../shared/types.js";

const env = await isolateTmuxEnv();
const { store } = await import("../../store/board.store.js");
const { startSession, commitCardStart } = await import("./start-session.js");
const { steps } = await import("./steps.js");
const { waitForMemory } = await import("./memory-wait.js");
const { memoryReading: reading, withMemoryFakes } =
  await import("../../test-support/memory-fixtures.js");

const config = (): Config => ({ workspaceRoot: env.root }) as Config;

void test("a reading above the floor passes at once with no sleep and no onWait call", async () => {
  await withMemoryFakes([reading(2048)], async ({ slept }) => {
    const waits: string[] = [];
    const result = await waitForMemory(DEFAULT_BOARD_KEY, (r) => {
      waits.push(r);
    });
    assert.deepEqual(result, { ok: true });
    assert.deepEqual(slept, []);
    assert.deepEqual(waits, []);
  });
});

void test("a low reading waits, calls onWait once, retries every 30 seconds and answers ok when memory frees", async () => {
  await withMemoryFakes(
    [reading(812), reading(900), reading(2048)],
    async ({ slept }) => {
      const waits: string[] = [];
      const result = await waitForMemory(DEFAULT_BOARD_KEY, (r) => {
        waits.push(r);
      });
      assert.deepEqual(result, { ok: true });
      assert.deepEqual(waits, [
        "free memory 812 MB is below the 1024 MB floor",
      ]);
      assert.deepEqual(slept, [30_000, 30_000]);
    },
  );
});

void test("after 30 minutes of 60 retries it refuses and the reason carries the last reading", async () => {
  const readings = [
    ...Array.from({ length: 60 }, () => reading(812)),
    reading(900),
  ];
  await withMemoryFakes(readings, async ({ slept, now }) => {
    const result = await waitForMemory(DEFAULT_BOARD_KEY);
    assert.equal(slept.length, 60);
    assert.ok(slept.every((ms) => ms === 30_000));
    assert.equal(now(), 1_800_000);
    assert.deepEqual(result, {
      ok: false,
      reason:
        "free memory 900 MB is below the 1024 MB floor after 30 minutes of retries",
    });
  });
});

void test("swap above the ceiling waits and frees when swap falls", async () => {
  await withMemoryFakes(
    [reading(2048, 9000), reading(2048, 9000), reading(2048, 4000)],
    async ({ slept }) => {
      const waits: string[] = [];
      const result = await waitForMemory(DEFAULT_BOARD_KEY, (r) => {
        waits.push(r);
      });
      assert.deepEqual(result, { ok: true });
      assert.deepEqual(waits, [
        "swap used 9000 MB is above the 8192 MB ceiling",
      ]);
      assert.deepEqual(slept, [30_000, 30_000]);
    },
  );
});

void test(
  "a card start waits in the queue, holds the start guard, then runs its steps",
  { skip: !env.canRunRealTmux },
  async (t) => {
    await store.load();
    const card = await store.createLocalCard(
      DEFAULT_BOARD_KEY,
      "memory queue",
      "",
    );
    const run = t.mock.method(steps[0]!, "run", () =>
      Promise.reject(new Error("saga stopped by the test")),
    );
    await withMemoryFakes(
      [reading(812), reading(2048)],
      async ({ onSleep }) => {
        const seen: { step?: string | null; starting: boolean }[] = [];
        let second: Promise<void> | undefined;
        onSleep(() => {
          seen.push({
            step: store.getCard(card.id)?.provisioningStep,
            starting: store.isStarting(card.id),
          });
          second = commitCardStart(card.id, config(), { extraDirection: "" });
          second.catch(() => {});
        });
        await startSession(card.id, "", config());
        assert.deepEqual(seen, [
          { step: "Waiting for memory…", starting: true },
        ]);
        await assert.rejects(second!, {
          message: "a session start is already in progress",
        });
      },
    );
    assert.equal(run.mock.callCount(), 1);
    assert.equal(store.isStarting(card.id), false);
  },
);

void test(
  "a card start fails with a clear reason after 30 minutes without memory",
  { skip: !env.canRunRealTmux },
  async (t) => {
    await store.load();
    const card = await store.createLocalCard(
      DEFAULT_BOARD_KEY,
      "memory refused",
      "",
    );
    const run = t.mock.method(steps[0]!, "run", () => Promise.resolve());
    await withMemoryFakes([reading(812)], async () => {
      await startSession(card.id, "", config());
    });
    assert.equal(run.mock.callCount(), 0);
    const after = store.getCard(card.id);
    assert.equal(after?.startError?.step, "checking memory");
    assert.equal(
      after?.startError?.stderr,
      "free memory 812 MB is below the 1024 MB floor after 30 minutes of retries",
    );
    assert.equal(after?.startError?.variant, "config");
    assert.equal(after?.provisioningStep, null);
    assert.equal(after?.column, "todo");
    assert.equal(store.isStarting(card.id), false);
  },
);

void test(
  "a hidden orchestrator card start does not wait for memory",
  { skip: !env.canRunRealTmux },
  async (t) => {
    await store.load();
    const card = await store.createOrchestratorCard(
      DEFAULT_BOARD_KEY,
      "memory hidden",
      "orch-memory",
    );
    const run = t.mock.method(steps[0]!, "run", () =>
      Promise.reject(new Error("saga stopped by the test")),
    );
    await withMemoryFakes([812], async ({ slept }) => {
      await startSession(card.id, "", config());
      assert.deepEqual(slept, []);
    });
    assert.equal(run.mock.callCount(), 1);
  },
);
