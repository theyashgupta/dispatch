import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  Card,
  ClaudeAccountSummary,
  Session,
} from "../../../../shared/types.js";
import { clock } from "../../../../shared/clock-text.js";
import { DEFAULT_USAGE_THRESHOLDS } from "../../../../shared/usage-thresholds.js";
import { accountFor, usageMeters } from "./usage-meters.js";

const UTC = { timeZone: "UTC", thresholds: DEFAULT_USAGE_THRESHOLDS };

function card(
  id: string,
  metersAt: string | undefined,
  usage: { fiveHourPercent: number | null; sevenDayPercent: number | null },
  claudeAccountId?: string,
): Card {
  const session = {
    id: `s-${id}`,
    createdAt: "",
    updatedAt: "",
    usage,
    ...(metersAt === undefined ? {} : { metersAt }),
    ...(claudeAccountId === undefined ? {} : { claudeAccountId }),
  } as Session;
  return { id, sessions: [session], activeSessionId: session.id } as Card;
}

function wireCard(
  id: string,
  updatedAt: string,
  usage: { fiveHourPercent: number | null; sevenDayPercent: number | null },
  claudeAccountId?: string,
): Card {
  return {
    id,
    activeSessionId: `s-${id}`,
    usage,
    ...(claudeAccountId === undefined ? {} : { claudeAccountId }),
    sessionSummaries: [
      { id: `s-${id}`, active: true, createdAt: "", updatedAt },
    ],
  } as Card;
}

function account(
  id: string,
  email: string,
  buckets: ClaudeAccountSummary["buckets"],
  isDefault = false,
): ClaudeAccountSummary {
  return { id, email, isDefault, buckets } as ClaudeAccountSummary;
}

const BUCKETS = [
  { kind: "five_hour", percent: 23, resetsAt: "2026-10-07T18:00:00Z" },
  { kind: "seven_day", percent: 41, resetsAt: "2026-10-12T05:30:00Z" },
];

test("one account shows window and week with reset times and no name", () => {
  const [entry] = usageMeters(
    [
      card("c1", "2026-10-07T10:00:00Z", {
        fiveHourPercent: 23,
        sevenDayPercent: 41,
      }),
    ],
    [account("default", "a@x.com", BUCKETS, true)],
    UTC,
  );
  assert.equal(entry?.name, null);
  assert.deepEqual(
    entry?.meters.map((m) => m.text),
    ["Window 23%, resets 18:00", "Week 41%, resets Mon 05:30"],
  );
});

function metersAt(
  fiveHourPercent: number,
  sevenDayPercent: number,
  opts: typeof UTC = UTC,
) {
  return usageMeters(
    [card("c1", "2026-10-07T10:00:00Z", { fiveHourPercent, sevenDayPercent })],
    [account("default", "a@x.com", BUCKETS, true)],
    opts,
  )[0]?.meters;
}

test("default thresholds read high use from 70 and near limit from 90", () => {
  const [low, high] = metersAt(69, 70) ?? [];
  assert.deepEqual(
    [low?.tone, low?.near, low?.text],
    ["ok", false, "Window 69%, resets 18:00"],
  );
  assert.deepEqual(
    [high?.tone, high?.near, high?.text],
    ["stale", true, "Week 70%, high use, resets Mon 05:30"],
  );
  const [, critical] = metersAt(89, 90) ?? [];
  assert.equal(
    metersAt(89, 90)?.[0]?.text,
    "Window 89%, high use, resets 18:00",
  );
  assert.deepEqual(
    [critical?.tone, critical?.near, critical?.text],
    ["down", true, "Week 90%, near limit, resets Mon 05:30"],
  );
});

test("custom warning 60 and critical 80 move the tone and label at each edge", () => {
  const custom = {
    timeZone: "UTC",
    thresholds: {
      ...DEFAULT_USAGE_THRESHOLDS,
      warningPercent: 60,
      criticalPercent: 80,
    },
  };
  const at = (percent: number) => metersAt(percent, 0, custom)?.[0];
  assert.deepEqual(
    [59, 60, 79, 80].map((p) => [at(p)?.tone, at(p)?.near, at(p)?.text]),
    [
      ["ok", false, "Window 59%, resets 18:00"],
      ["stale", true, "Window 60%, high use, resets 18:00"],
      ["stale", true, "Window 79%, high use, resets 18:00"],
      ["down", true, "Window 80%, near limit, resets 18:00"],
    ],
  );
});

test("a missing bucket reads reset time unknown and a null percent is skipped", () => {
  const [entry] = usageMeters(
    [
      card("c1", "2026-10-07T10:00:00Z", {
        fiveHourPercent: 23,
        sevenDayPercent: null,
      }),
    ],
    [account("default", "a@x.com", [], true)],
    UTC,
  );
  assert.deepEqual(
    entry?.meters.map((m) => m.text),
    ["Window 23%, reset time unknown"],
  );
});

test("the newest metersAt of an account wins and cards without meters are skipped", () => {
  const entries = usageMeters(
    [
      card("c1", "2026-10-07T09:00:00Z", {
        fiveHourPercent: 10,
        sevenDayPercent: 10,
      }),
      card("c2", "2026-10-07T11:00:00Z", {
        fiveHourPercent: 30,
        sevenDayPercent: 50,
      }),
      card("c3", undefined, { fiveHourPercent: 99, sevenDayPercent: 99 }),
    ],
    [account("default", "a@x.com", BUCKETS, true)],
    UTC,
  );
  assert.equal(entries.length, 1);
  assert.deepEqual(
    entries[0]?.meters.map((m) => m.percent),
    [30, 50],
  );
});

test("two accounts are named by email, and the default account reads Default", () => {
  const entries = usageMeters(
    [
      card("c1", "2026-10-07T10:00:00Z", {
        fiveHourPercent: 5,
        sevenDayPercent: 6,
      }),
      card(
        "c2",
        "2026-10-07T10:00:00Z",
        { fiveHourPercent: 7, sevenDayPercent: 8 },
        "acc-2",
      ),
    ],
    [
      account("default", "a@x.com", BUCKETS, true),
      account("acc-2", "b@x.com", BUCKETS),
    ],
    UTC,
  );
  assert.deepEqual(
    entries.map((e) => [e.accountId, e.name]),
    [
      ["acc-2", "b@x.com"],
      ["default", "Default"],
    ],
  );
});

test("wire-shape cards fill the meters and the newest updatedAt of an account wins", () => {
  const entries = usageMeters(
    [
      wireCard("c1", "2026-10-07T09:00:00Z", {
        fiveHourPercent: 10,
        sevenDayPercent: 10,
      }),
      wireCard("c2", "2026-10-07T11:00:00Z", {
        fiveHourPercent: 30,
        sevenDayPercent: 50,
      }),
    ],
    [account("default", "a@x.com", BUCKETS, true)],
    UTC,
  );
  assert.equal(entries.length, 1);
  assert.deepEqual(
    entries[0]?.meters.map((m) => m.text),
    ["Window 30%, resets 18:00", "Week 50%, resets Mon 05:30"],
  );
});

test("a Done card, a lost session and a lost card feed no meter", () => {
  const usage = { fiveHourPercent: 40, sevenDayPercent: 60 };
  const done = { ...card("c1", "2026-10-07T10:00:00Z", usage), column: "done" };
  const lostCard = {
    ...card("c2", "2026-10-07T10:00:00Z", usage),
    sessionLost: true,
  };
  const lostState = {
    ...card("c3", "2026-10-07T10:00:00Z", usage),
    state: "lost",
  };
  const accounts = [account("default", "a@x.com", BUCKETS, true)];
  assert.deepEqual(
    usageMeters([done, lostCard, lostState] as Card[], accounts, UTC),
    [],
  );
  assert.equal(
    usageMeters(
      [done, card("c4", "2026-10-07T09:00:00Z", usage)] as Card[],
      accounts,
      UTC,
    ).length,
    1,
  );
});

test("an unparseable reset time reads reset time unknown and does not throw", () => {
  assert.equal(clock("garbage", "UTC", false), null);
  const [entry] = usageMeters(
    [
      card("c1", "2026-10-07T10:00:00Z", {
        fiveHourPercent: 23,
        sevenDayPercent: 41,
      }),
    ],
    [
      account(
        "default",
        "a@x.com",
        [
          { kind: "five_hour", percent: 23, resetsAt: "garbage" },
          { kind: "seven_day", percent: 41, resetsAt: "2026-10-12T05:30:00Z" },
        ],
        true,
      ),
    ],
    UTC,
  );
  assert.deepEqual(
    entry?.meters.map((m) => m.text),
    ["Window 23%, reset time unknown", "Week 41%, resets Mon 05:30"],
  );
});

test("a default session finds the managed Default row", () => {
  const managed = {
    ...account("m-1", "me@home.test", []),
    managedDefault: true,
  } as ClaudeAccountSummary;
  const other = account("acc-1", "work@corp.test", []);
  assert.equal(accountFor([other, managed], "default"), managed);
  assert.equal(accountFor([other], "default"), undefined);
});
