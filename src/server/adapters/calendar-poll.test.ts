import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { isolateEnv } from "../test-support/fixtures.js";
import type { CalendarSourceConfig, Config } from "../../shared/types.js";
import type { CalendarEvent } from "../sources/calendar/calendar-events.js";
import { DEFAULT_BOARD_KEY } from "../../shared/board-key.js";

isolateEnv();
const { store } = await import("../store/board.store.js");
const { buildRegistry, setMacCalendarReader } =
  await import("../sources/registry.js");
const { startEnabledPollers, stopPollers } = await import("./poller.js");
await store.load();

afterEach(() => stopPollers());

const MIN = 60_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function macEvent(uid: string, startMin: number, now: Date): CalendarEvent {
  return {
    uid,
    title: `Event ${uid}`,
    start: new Date(now.getTime() + startMin * MIN).toISOString(),
    end: new Date(now.getTime() + (startMin + 30) * MIN).toISOString(),
    allDay: false,
    calendar: "Work",
  };
}

function calendarConfig(calendar: CalendarSourceConfig): Config {
  return { linearApiKey: "", sources: { linear: { apiKey: "" }, calendar } };
}

test("with enabled absent the calendar source never polls", async () => {
  let reads = 0;
  setMacCalendarReader(() => {
    reads += 1;
    return Promise.resolve({ events: [], partial: false });
  });
  buildRegistry(calendarConfig({ mode: "macos", pollIntervalMs: 10 }));
  startEnabledPollers();
  await sleep(80);
  assert.equal(reads, 0);
});

test("an event gone from a complete read is auto-done through the real poller", async () => {
  let call = 0;
  setMacCalendarReader(() => {
    call += 1;
    const now = new Date();
    return Promise.resolve({
      events:
        call === 1
          ? [macEvent("keep", 30, now), macEvent("drop", 90, now)]
          : [macEvent("keep", 30, now)],
      partial: false,
    });
  });
  buildRegistry(
    calendarConfig({ enabled: true, mode: "macos", pollIntervalMs: 20 }),
  );
  startEnabledPollers();
  const states = () =>
    new Map(
      store
        .listItems()
        .filter((i) => i.source === "calendar")
        .map((i) => [i.id.split(":")[1], i.state]),
    );
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline && states().get("drop") !== "done") {
    await sleep(20);
  }
  stopPollers();
  assert.ok(call >= 2, `polled ${call} times`);
  assert.equal(states().get("keep"), "unread");
  assert.equal(states().get("drop"), "done");
  assert.ok(
    store.snapshot(DEFAULT_BOARD_KEY).enabledSources?.includes("calendar"),
  );
});
