import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { readClock, subscribeClock } from "./wake-clock.js";

const START = 1_000_000;
const TICK = 60_000;

test("the first subscribe starts one interval that serves every listener", () => {
  mock.timers.enable({ apis: ["setInterval", "Date"], now: START });
  try {
    let first = 0;
    let second = 0;
    const offFirst = subscribeClock(() => first++);
    const offSecond = subscribeClock(() => second++);
    assert.equal(readClock(), START);

    mock.timers.tick(TICK);
    assert.equal(first, 1);
    assert.equal(second, 1);
    assert.equal(readClock(), START + TICK);

    offFirst();
    offSecond();
  } finally {
    mock.timers.reset();
  }
});

test("the last unsubscribe clears the interval and a later subscribe starts a fresh one", () => {
  mock.timers.enable({ apis: ["setInterval", "Date"], now: START });
  try {
    let calls = 0;
    const off = subscribeClock(() => calls++);
    const other = subscribeClock(() => undefined);
    off();
    mock.timers.tick(TICK);
    assert.equal(calls, 0);
    other();

    mock.timers.tick(TICK * 3);
    assert.equal(calls, 0);
    assert.equal(readClock(), START + TICK);

    const again = subscribeClock(() => calls++);
    assert.equal(readClock(), START + TICK * 4);
    mock.timers.tick(TICK);
    assert.equal(calls, 1);
    again();
  } finally {
    mock.timers.reset();
  }
});
