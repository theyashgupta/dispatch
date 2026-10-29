import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import type { BoardCounts } from "../../src/shared/types.js";
import { MINUTE, makeNote, startSandbox } from "./harness/sandbox.js";

const DEFAULT_BOARD = "LOCAL";
const NOTIFY_ON = "[notify] loop phase notifications are on";
const FAKE_USER = "fake-user-168";
const FAKE_TOKEN = "fake-token-168";

const note = makeNote("local-168-pushover-attention");

interface PushoverSnapshot {
  pushoverMissing?: { names: string[]; since: string };
}

const notifyLines = (log: string): string[] =>
  log.split("\n").filter((line) => line.includes("[notify]"));

void test(
  "scenario-LOCAL-168-pushover-attention: empty Pushover values give one attention item and one start log line",
  { timeout: 5 * MINUTE },
  async () => {
    const sb = await startSandbox({
      name: "local-168-pushover-attention-empty",
      env: { PUSHOVER_USER_KEY: "", PUSHOVER_APP_TOKEN: "" },
    });
    try {
      const lines = fs
        .readFileSync(sb.serverLog, "utf8")
        .split("\n")
        .filter((line) => line.startsWith(NOTIFY_ON));
      assert.equal(lines.length, 1);
      assert.ok(lines[0].includes("PUSHOVER_USER_KEY"));
      assert.ok(lines[0].includes("PUSHOVER_APP_TOKEN"));
      note(`start log: ${lines[0]}`);

      const snapshot = await sb.api<PushoverSnapshot>(
        "GET",
        `/api/board?board=${DEFAULT_BOARD}`,
      );
      assert.equal(snapshot.status, 200);
      assert.deepEqual(snapshot.body.pushoverMissing?.names, [
        "PUSHOVER_USER_KEY",
        "PUSHOVER_APP_TOKEN",
      ]);

      const counts = await sb.api<BoardCounts>("GET", "/api/boards/counts");
      assert.equal(counts.status, 200);
      const own = counts.body.counts.find((c) => c.key === DEFAULT_BOARD);
      assert.equal(own?.attention, 1);
      note("one attention item on the default board");
    } finally {
      await sb.stop();
    }
  },
);

void test(
  "scenario-LOCAL-168-pushover-attention: fake Pushover values give no item and no log line",
  { timeout: 5 * MINUTE },
  async () => {
    const sb = await startSandbox({
      name: "local-168-pushover-attention-filled",
      env: { PUSHOVER_USER_KEY: FAKE_USER, PUSHOVER_APP_TOKEN: FAKE_TOKEN },
    });
    try {
      const log = fs.readFileSync(sb.serverLog, "utf8");
      assert.deepEqual(notifyLines(log), []);

      const snapshot = await sb.api<PushoverSnapshot>(
        "GET",
        `/api/board?board=${DEFAULT_BOARD}`,
      );
      assert.equal(snapshot.status, 200);
      assert.equal(snapshot.body.pushoverMissing, undefined);

      const counts = await sb.api<BoardCounts>("GET", "/api/boards/counts");
      assert.equal(counts.status, 200);
      const own = counts.body.counts.find((c) => c.key === DEFAULT_BOARD);
      assert.equal(own?.attention, 0);

      const seen = [
        fs.readFileSync(sb.serverLog, "utf8"),
        JSON.stringify(snapshot.body),
        JSON.stringify(counts.body),
      ].join("\n");
      assert.ok(!seen.includes(FAKE_USER));
      assert.ok(!seen.includes(FAKE_TOKEN));
      note("no item, no log line, no value leaked");
    } finally {
      await sb.stop();
    }
  },
);
