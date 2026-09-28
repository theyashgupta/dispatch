import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, test } from "node:test";
import type { CalendarSourceConfig } from "../../../shared/types.js";
import { CalendarSource, type MacCalendarReader } from "./calendar.source.js";
import { CalendarReadError, type CalendarEvent } from "./calendar-events.js";

const NOW = new Date("2026-11-02T14:00:00.000Z");
const MIN = 60_000;

function macEvent(uid: string, startMin: number, now = NOW): CalendarEvent {
  return {
    uid,
    title: `Event ${uid}`,
    start: new Date(now.getTime() + startMin * MIN).toISOString(),
    end: new Date(now.getTime() + (startMin + 30) * MIN).toISOString(),
    allDay: false,
    calendar: "Work",
  };
}

function source(
  settings: CalendarSourceConfig,
  readers: {
    mac?: MacCalendarReader;
    url?: string | null;
  },
  now = NOW,
) {
  return new CalendarSource(
    () => settings,
    {
      mac: () => readers.mac,
      resolveIcalUrl: () => Promise.resolve(readers.url ?? null),
    },
    300_000,
    () => now,
  );
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "resolved";
  } catch (err) {
    assert.ok(err instanceof CalendarReadError);
    return err.message;
  }
}

const SECRET = "/s3cr3t-calendar-path.ics";
let body = "";
let status = 200;
const requests: string[] = [];
const server = http
  .createServer((req, res) => {
    requests.push(req.url ?? "");
    if (req.url === "/to-refused") {
      res.writeHead(302, { location: "http://example.com/x" }).end();
    } else if (req.url === "/to-secret") {
      res.writeHead(302, { location: SECRET }).end();
    } else if (req.url?.startsWith("/s3cr3t-chain/")) {
      const hop = Number(req.url.slice("/s3cr3t-chain/".length));
      if (hop < 6) {
        res.writeHead(302, { location: `/s3cr3t-chain/${hop + 1}` }).end();
      } else {
        res.writeHead(200).end(FIXTURE);
      }
    } else if (req.url === "/s3cr3t-no-location") {
      res.writeHead(302).end(FIXTURE);
    } else if (req.url === "/s3cr3t-drop") {
      res.writeHead(200, { "content-length": "100000" });
      res.write("BEGIN:VCALENDAR\r\n");
      setTimeout(() => res.socket?.destroy(), 20);
    } else {
      res.writeHead(req.url === SECRET ? status : 404).end(body);
    }
  })
  .listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
after(() => server.close());

const FIXTURE = [
  "BEGIN:VCALENDAR",
  "X-WR-CALNAME:Team",
  "BEGIN:VEVENT",
  "UID:once",
  "DTSTART:20261102T150000Z",
  "DTEND:20261102T153000Z",
  "SUMMARY:One-off",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:daily",
  "DTSTART:20261001T160000Z",
  "DURATION:PT15M",
  "RRULE:FREQ=DAILY",
  "SUMMARY:Standup",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:monthly",
  "DTSTART:20261002T160000Z",
  "RRULE:FREQ=MONTHLY",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

test("macOS mode maps the reader's events to items with the ladder priorities and records the status", async () => {
  const localNow = new Date(2026, 10, 2, 9);
  const calls: (readonly string[])[] = [];
  const src = source(
    { mode: "macos", calendars: ["Work"] },
    {
      mac: (_from, _to, calendars) => {
        calls.push(calendars);
        return Promise.resolve({
          events: [
            macEvent("soon", 10, localNow),
            macEvent("later", 45, localNow),
            macEvent("today", 120, localNow),
          ],
          partial: false,
        });
      },
    },
    localNow,
  );
  const result = await src.fetch();
  assert.deepEqual(calls, [["Work"]]);
  assert.equal(result.truncated, false);
  assert.deepEqual(
    result.items.map((i) => [i.id.split(":")[1], i.priority]),
    [
      ["soon", 92],
      ["later", 84],
      ["today", 64],
    ],
  );
  assert.deepEqual(src.status, {
    lastPolledAt: localNow.toISOString(),
    eventCount: 3,
  });
});

test("a macOS read with a missing saved calendar returns the rest as a partial pull", async () => {
  const src = source(
    { mode: "macos", calendars: ["Work", "Home"] },
    {
      mac: () =>
        Promise.resolve({ events: [macEvent("work", 30)], partial: true }),
    },
  );
  const result = await src.fetch();
  assert.equal(result.truncated, true);
  assert.deepEqual(
    result.items.map((i) => i.id.split(":")[1]),
    ["work"],
  );
});

test("a reader failure is rethrown as its code and recorded as lastError", async () => {
  const src = source(
    { mode: "macos" },
    { mac: () => Promise.reject(new CalendarReadError("calendar-denied")) },
  );
  assert.equal(await codeOf(src.fetch()), "calendar-denied");
  assert.equal(src.status.lastError, "calendar-denied");
  const bare = source({ mode: "macos" }, {});
  assert.equal(await codeOf(bare.fetch()), "failed");
});

test("iCal mode refuses a missing URL and a non-loopback http URL without any request", async () => {
  const before = requests.length;
  const realFetch = globalThis.fetch;
  let fetched = 0;
  globalThis.fetch = (...args) => {
    fetched += 1;
    return realFetch(...args);
  };
  try {
    assert.equal(
      await codeOf(source({ mode: "ical" }, { url: null }).fetch()),
      "ical-url-missing",
    );
    assert.equal(
      await codeOf(source({ mode: "ical" }, { url: "  " }).fetch()),
      "ical-url-missing",
    );
    for (const url of [
      "http://example.com/x",
      "ftp://127.0.0.1/x",
      "https://u:p@example.com/x",
      "not a url",
    ]) {
      assert.equal(
        await codeOf(source({ mode: "ical" }, { url }).fetch()),
        "ical-url-invalid",
      );
    }
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(fetched, 0);
  assert.equal(requests.length, before);
});

test("iCal mode reads a loopback calendar, expands the daily series and passes the MONTHLY partial on", async () => {
  body = FIXTURE;
  status = 200;
  const src = source({ mode: "ical" }, { url: `${base}${SECRET}` });
  const result = await src.fetch();
  assert.equal(result.truncated, true);
  const ids = result.items.map((i) => i.id);
  assert.ok(ids.includes("calendar:once:2026-11-02T15:00:00.000Z"));
  assert.ok(ids.includes("calendar:daily:2026-11-02T16:00:00.000Z"));
  assert.ok(ids.includes("calendar:daily:2026-11-03T16:00:00.000Z"));
  assert.equal(
    ids.some((id) => id.startsWith("calendar:monthly:")),
    false,
  );
  assert.ok(result.items.every((i) => i.meta.calendar === "Team"));
});

test("404, a non-calendar body and a body over 5 MB map to codes that never carry the URL", async () => {
  const src = source({ mode: "ical" }, { url: `${base}${SECRET}` });
  for (const [code, next, answer] of [
    ["ical-unreachable", "", 404],
    ["ical-invalid", "just text", 200],
    [
      "ical-too-large",
      "BEGIN:VCALENDAR\r\n" + "A".repeat(6 * 1024 * 1024),
      200,
    ],
  ] as const) {
    body = next;
    status = answer;
    let message = "";
    try {
      await src.fetch();
    } catch (err) {
      message = (err as Error).message;
    }
    assert.equal(message, code);
    assert.equal(JSON.stringify(src.status).includes("s3cr3t"), false);
  }
});

test("a redirect is followed only to a URL that passes the same scheme and host rule", async () => {
  body = FIXTURE;
  status = 200;
  const ok = await source(
    { mode: "ical" },
    { url: `${base}/to-secret` },
  ).fetch();
  assert.ok(ok.items.length > 0);
  assert.equal(
    await codeOf(
      source({ mode: "ical" }, { url: `${base}/to-refused` }).fetch(),
    ),
    "ical-url-invalid",
  );
});

test("a remote feed may not redirect to a loopback http URL, and a failed answer's body is cancelled", async () => {
  body = FIXTURE;
  status = 200;
  const before = requests.length;
  const realFetch = globalThis.fetch;
  let cancelled = false;
  globalThis.fetch = (input, init) => {
    const href = input instanceof URL ? input.href : "";
    if (href === "https://feed.example.com/to-loopback") {
      return Promise.resolve(
        new Response(null, {
          status: 302,
          headers: { location: `${base}${SECRET}` },
        }),
      );
    }
    if (href === "https://feed.example.com/gone") {
      const stream = new ReadableStream({
        cancel() {
          cancelled = true;
        },
      });
      return Promise.resolve(new Response(stream, { status: 500 }));
    }
    return realFetch(input, init);
  };
  try {
    assert.equal(
      await codeOf(
        source(
          { mode: "ical" },
          { url: "https://feed.example.com/to-loopback" },
        ).fetch(),
      ),
      "ical-url-invalid",
    );
    assert.equal(
      await codeOf(
        source(
          { mode: "ical" },
          { url: "https://feed.example.com/gone" },
        ).fetch(),
      ),
      "ical-unreachable",
    );
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(requests.length, before);
  assert.equal(cancelled, true);
});

test("the calendar source is items-only, so a poll never touches the board sync fields", () => {
  assert.equal(source({ mode: "macos" }, {}).itemsOnly, true);
});

test("five chained redirects are followed and a sixth answers ical-unreachable without the URL", async () => {
  const five = await source(
    { mode: "ical" },
    { url: `${base}/s3cr3t-chain/1` },
  ).fetch();
  assert.ok(five.items.length > 0);
  const src = source({ mode: "ical" }, { url: `${base}/s3cr3t-chain/0` });
  assert.equal(await codeOf(src.fetch()), "ical-unreachable");
  assert.equal(JSON.stringify(src.status).includes("s3cr3t"), false);
});

test("a redirect with no Location header answers ical-unreachable and is not followed", async () => {
  const before = requests.length;
  const src = source({ mode: "ical" }, { url: `${base}/s3cr3t-no-location` });
  assert.equal(await codeOf(src.fetch()), "ical-unreachable");
  assert.deepEqual(requests.slice(before), ["/s3cr3t-no-location"]);
  assert.equal(JSON.stringify(src.status).includes("s3cr3t"), false);
});

test("a connection dropped mid-download answers ical-unreachable without the URL", async () => {
  const src = source({ mode: "ical" }, { url: `${base}/s3cr3t-drop` });
  assert.equal(await codeOf(src.fetch()), "ical-unreachable");
  assert.equal(JSON.stringify(src.status).includes("s3cr3t"), false);
});
