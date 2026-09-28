import assert from "node:assert/strict";
import { test } from "node:test";
import { parseIcs } from "./ics.js";

function ics(...events: string[][]): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    ...events.flatMap((lines) => ["BEGIN:VEVENT", ...lines, "END:VEVENT"]),
    "END:VCALENDAR",
  ].join("\r\n");
}

const FROM = new Date("2026-10-19T00:00:00Z");
const TO = new Date("2026-11-16T00:00:00Z");

function starts(text: string, from = FROM, to = TO): string[] {
  return parseIcs(text, from, to).events.map((e) => e.start);
}

test("folded lines rejoin without the leading space or tab, with CRLF and LF", () => {
  const crlf = ics([
    "UID:a",
    "DTSTART:20261102T150000Z",
    "SUMMARY:Plan the off",
    " site review",
    "DESCRIPTION:Tabbed",
    "\tline",
  ]);
  const [event] = parseIcs(crlf, FROM, TO).events;
  assert.equal(event.title, "Plan the offsite review");
  assert.equal(event.notes, "Tabbedline");
  const lf = crlf.replaceAll("\r\n", "\n");
  assert.equal(
    parseIcs(lf, FROM, TO).events[0].title,
    "Plan the offsite review",
  );
});

test("text values unescape newlines, commas, semicolons and backslashes", () => {
  const text = ics([
    "UID:a",
    "DTSTART:20261102T150000Z",
    String.raw`DESCRIPTION:One\nTwo\, three\; four\\five`,
    String.raw`LOCATION:Room 1\, floor 2`,
  ]);
  const [event] = parseIcs(text, FROM, TO).events;
  assert.equal(event.notes, "One\nTwo, three; four\\five");
  assert.equal(event.location, "Room 1, floor 2");
});

test("UTC, floating and all-day forms read to the right instants", () => {
  const text = ics(
    ["UID:utc", "DTSTART:20261102T150000Z", "DTEND:20261102T153000Z"],
    ["UID:floating", "DTSTART:20261103T100000", "DTEND:20261103T110000"],
    ["UID:allday", "DTSTART;VALUE=DATE:20261104"],
  );
  const byUid = new Map(parseIcs(text, FROM, TO).events.map((e) => [e.uid, e]));
  assert.equal(byUid.get("utc")?.start, "2026-11-02T15:00:00.000Z");
  assert.equal(byUid.get("utc")?.end, "2026-11-02T15:30:00.000Z");
  assert.equal(
    byUid.get("floating")?.start,
    new Date(2026, 10, 3, 10).toISOString(),
  );
  const allDay = byUid.get("allday");
  assert.equal(allDay?.allDay, true);
  assert.equal(allDay?.start, new Date(2026, 10, 4).toISOString());
  assert.equal(allDay?.end, new Date(2026, 10, 5).toISOString());
});

test("a TZID America/New_York 10:00 event reads as 14:00Z before and 15:00Z after the November change", () => {
  const text = ics(
    [
      "UID:before",
      "DTSTART;TZID=America/New_York:20261026T100000",
      "DTEND;TZID=America/New_York:20261026T103000",
    ],
    [
      "UID:after",
      "DTSTART;TZID=America/New_York:20261102T100000",
      "DTEND;TZID=America/New_York:20261102T103000",
    ],
  );
  const byUid = new Map(parseIcs(text, FROM, TO).events.map((e) => [e.uid, e]));
  assert.equal(byUid.get("before")?.start, "2026-10-26T14:00:00.000Z");
  assert.equal(byUid.get("before")?.end, "2026-10-26T14:30:00.000Z");
  assert.equal(byUid.get("after")?.start, "2026-11-02T15:00:00.000Z");
});

test("a weekly New York series stays at 10:00 local across the DST change", () => {
  const text = ics([
    "UID:w",
    "DTSTART;TZID=America/New_York:20261026T100000",
    "DURATION:PT30M",
    "RRULE:FREQ=WEEKLY;COUNT=2",
  ]);
  const events = parseIcs(text, FROM, TO).events;
  assert.deepEqual(
    events.map((e) => e.start),
    ["2026-10-26T14:00:00.000Z", "2026-11-02T15:00:00.000Z"],
  );
  assert.equal(events[1].end, "2026-11-02T15:30:00.000Z");
});

test("an unknown TZID reads as floating local time", () => {
  const text = ics(["UID:x", "DTSTART;TZID=Mars/Olympus:20261102T100000"]);
  assert.deepEqual(starts(text), [new Date(2026, 10, 2, 10).toISOString()]);
});

test("a weekly Monday and Wednesday series drops the EXDATE, moves the RECURRENCE-ID and drops a cancelled instance", () => {
  const text = ics(
    [
      "UID:mw",
      "DTSTART:20261019T090000Z",
      "DTEND:20261019T093000Z",
      "RRULE:FREQ=WEEKLY;BYDAY=MO,WE",
      "EXDATE:20261021T090000Z",
      "SUMMARY:Standup",
    ],
    [
      "UID:mw",
      "RECURRENCE-ID:20261026T090000Z",
      "DTSTART:20261026T130000Z",
      "DTEND:20261026T133000Z",
      "SUMMARY:Standup moved",
    ],
    [
      "UID:mw",
      "RECURRENCE-ID:20261028T090000Z",
      "DTSTART:20261028T090000Z",
      "STATUS:CANCELLED",
    ],
  );
  const events = parseIcs(text, FROM, new Date("2026-11-03T00:00:00Z")).events;
  assert.deepEqual(
    events.map((e) => [e.start, e.title]),
    [
      ["2026-10-19T09:00:00.000Z", "Standup"],
      ["2026-10-26T13:00:00.000Z", "Standup moved"],
      ["2026-11-02T09:00:00.000Z", "Standup"],
    ],
  );
  assert.equal(events[1].end, "2026-10-26T13:30:00.000Z");
});

test("INTERVAL, UNTIL and COUNT bound the series", () => {
  const every2 = ics([
    "UID:i",
    "DTSTART:20261019T090000Z",
    "RRULE:FREQ=DAILY;INTERVAL=2;COUNT=3",
  ]);
  assert.deepEqual(starts(every2), [
    "2026-10-19T09:00:00.000Z",
    "2026-10-21T09:00:00.000Z",
    "2026-10-23T09:00:00.000Z",
  ]);
  const until = ics([
    "UID:u",
    "DTSTART:20261019T090000Z",
    "RRULE:FREQ=DAILY;UNTIL=20261021T090000Z",
  ]);
  assert.equal(starts(until).length, 3);
  const weeklyTwo = ics([
    "UID:w2",
    "DTSTART:20261019T090000Z",
    "RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO",
  ]);
  assert.deepEqual(starts(weeklyTwo), [
    "2026-10-19T09:00:00.000Z",
    "2026-11-02T09:00:00.000Z",
  ]);
});

test("a daily series that began years ago still yields its instances inside the window", () => {
  const old = ics(["UID:old", "DTSTART:20200101T090000Z", "RRULE:FREQ=DAILY"]);
  const window = starts(
    old,
    new Date("2026-11-02T00:00:00Z"),
    new Date("2026-11-04T00:00:00Z"),
  );
  assert.deepEqual(window, [
    "2026-11-02T09:00:00.000Z",
    "2026-11-03T09:00:00.000Z",
  ]);
});

test("a MONTHLY series and a BYMONTHDAY rule are skipped and the result is partial", () => {
  const text = ics(
    ["UID:m", "DTSTART:20261020T090000Z", "RRULE:FREQ=MONTHLY"],
    ["UID:bmd", "DTSTART:20261020T090000Z", "RRULE:FREQ=WEEKLY;BYMONTHDAY=20"],
    ["UID:keep", "DTSTART:20261021T090000Z"],
  );
  const result = parseIcs(text, FROM, TO);
  assert.equal(result.partial, true);
  assert.deepEqual(
    result.events.map((e) => e.uid),
    ["keep"],
  );
  assert.equal(
    parseIcs(ics(["UID:keep", "DTSTART:20261021T090000Z"]), FROM, TO).partial,
    false,
  );
});

test("only events overlapping the window stay; DURATION stands in for a missing DTEND", () => {
  const text = ics(
    ["UID:ended", "DTSTART:20261018T230000Z", "DTEND:20261019T000000Z"],
    ["UID:across", "DTSTART:20261018T233000Z", "DURATION:PT1H"],
    ["UID:after", "DTSTART:20261116T000000Z"],
    ["UID:cancelled", "DTSTART:20261020T090000Z", "STATUS:CANCELLED"],
  );
  const events = parseIcs(text, FROM, TO).events;
  assert.deepEqual(
    events.map((e) => e.uid),
    ["across"],
  );
  assert.equal(events[0].end, "2026-10-19T00:30:00.000Z");
});

test("the calendar name comes from X-WR-CALNAME, else iCal", () => {
  const named = ics(["UID:a", "DTSTART:20261102T150000Z"]).replace(
    "VERSION:2.0",
    "VERSION:2.0\r\nX-WR-CALNAME:Work",
  );
  assert.equal(parseIcs(named, FROM, TO).events[0].calendar, "Work");
  assert.equal(
    parseIcs(ics(["UID:a", "DTSTART:20261102T150000Z"]), FROM, TO).events[0]
      .calendar,
    "iCal",
  );
});

test("a VALARM inside an event does not leak its properties", () => {
  const text = ics([
    "UID:a",
    "DTSTART:20261102T150000Z",
    "SUMMARY:Real",
    "BEGIN:VALARM",
    "DESCRIPTION:Reminder",
    "END:VALARM",
  ]);
  const [event] = parseIcs(text, FROM, TO).events;
  assert.equal(event.title, "Real");
  assert.equal(event.notes, undefined);
});

test("a COUNT series that began years ago still reaches the window, and a finished one stays finished", () => {
  const live = ics([
    "UID:c",
    "DTSTART:20150101T090000Z",
    "RRULE:FREQ=DAILY;COUNT=5000",
  ]);
  const window = [
    new Date("2026-11-02T00:00:00Z"),
    new Date("2026-11-04T00:00:00Z"),
  ] as const;
  assert.deepEqual(starts(live, ...window), [
    "2026-11-02T09:00:00.000Z",
    "2026-11-03T09:00:00.000Z",
  ]);
  assert.equal(parseIcs(live, ...window).partial, false);
  const done = ics([
    "UID:d",
    "DTSTART:20150101T090000Z",
    "RRULE:FREQ=DAILY;COUNT=10",
  ]);
  assert.deepEqual(starts(done, ...window), []);
  const weekly = ics([
    "UID:w",
    "DTSTART:20150105T090000Z",
    "RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=1238",
  ]);
  assert.deepEqual(starts(weekly, ...window), ["2026-11-02T09:00:00.000Z"]);
});

test("WKST SU groups a biweekly Monday and Sunday series by Sunday-first weeks", () => {
  const text = ics([
    "UID:k",
    "DTSTART:20261005T090000Z",
    "RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,SU;WKST=SU",
  ]);
  assert.deepEqual(
    starts(
      text,
      new Date("2026-10-01T00:00:00Z"),
      new Date("2026-11-03T00:00:00Z"),
    ),
    [
      "2026-10-05T09:00:00.000Z",
      "2026-10-18T09:00:00.000Z",
      "2026-10-19T09:00:00.000Z",
      "2026-11-01T09:00:00.000Z",
      "2026-11-02T09:00:00.000Z",
    ],
  );
});

test("a date-only UNTIL is read in the event zone, not the server zone", () => {
  const text = ics([
    "UID:u",
    "DTSTART;TZID=America/New_York:20261005T190000",
    "RRULE:FREQ=DAILY;UNTIL=20261007",
  ]);
  assert.deepEqual(
    starts(
      text,
      new Date("2026-10-01T00:00:00Z"),
      new Date("2026-10-10T00:00:00Z"),
    ),
    [
      "2026-10-05T23:00:00.000Z",
      "2026-10-06T23:00:00.000Z",
      "2026-10-07T23:00:00.000Z",
    ],
  );
});

test("an RDATE inside the window marks the pull partial", () => {
  const text = ics([
    "UID:r",
    "DTSTART:20261020T090000Z",
    "RDATE:20261022T090000Z",
  ]);
  const result = parseIcs(text, FROM, TO);
  assert.equal(result.partial, true);
  assert.equal(result.events.length, 1);
});

test("a window wider than the 1000-period cap marks the pull partial", () => {
  const open = ics(["UID:o", "DTSTART:20260101T090000Z", "RRULE:FREQ=DAILY"]);
  const result = parseIcs(
    open,
    new Date("2026-01-01T00:00:00Z"),
    new Date("2029-01-01T00:00:00Z"),
  );
  assert.equal(result.partial, true);
  assert.equal(result.events.length, 1000);
});

test("a skipped series or an RDATE that cannot reach the window leaves the pull complete", () => {
  const ended = ics(
    [
      "UID:old-monthly",
      "DTSTART:20100105T090000Z",
      "RRULE:FREQ=MONTHLY;UNTIL=20161231T000000Z",
    ],
    [
      "UID:old-yearly",
      "DTSTART;VALUE=DATE:20100105",
      "RRULE:FREQ=YEARLY;UNTIL=20150105",
    ],
    ["UID:later", "DTSTART:20270105T090000Z", "RRULE:FREQ=MONTHLY"],
    ["UID:rdate", "DTSTART:20100105T090000Z", "RDATE:20120105T090000Z"],
    ["UID:keep", "DTSTART:20261021T090000Z"],
  );
  const result = parseIcs(ended, FROM, TO);
  assert.equal(result.partial, false);
  assert.deepEqual(
    result.events.map((e) => e.uid),
    ["keep"],
  );
  const open = ics([
    "UID:live",
    "DTSTART:20100105T090000Z",
    "RRULE:FREQ=MONTHLY;UNTIL=20261020T000000Z",
  ]);
  assert.equal(parseIcs(open, FROM, TO).partial, true);
});

test("a skipped series bounded by COUNT stops marking the pull partial once its longest reach ends", () => {
  const ended = ics(
    [
      "UID:old-count",
      "DTSTART:20100105T090000Z",
      "RRULE:FREQ=MONTHLY;COUNT=12",
    ],
    [
      "UID:old-yearly-count",
      "DTSTART:20000105T090000Z",
      "RRULE:FREQ=YEARLY;INTERVAL=2;COUNT=3",
    ],
  );
  assert.equal(parseIcs(ended, FROM, TO).partial, false);
  const live = ics([
    "UID:live-count",
    "DTSTART:20260105T090000Z",
    "RRULE:FREQ=MONTHLY;BYMONTHDAY=5;COUNT=10",
  ]);
  assert.equal(parseIcs(live, FROM, TO).partial, true);
  for (const rule of [
    "FREQ=DAILY;BYMONTHDAY=1;COUNT=12",
    "FREQ=WEEKLY;BYMONTH=1;COUNT=6",
    "FREQ=DAILY;BYDAY=MO;COUNT=45",
  ]) {
    const byPart = ics([
      "UID:by-part",
      "DTSTART:20260105T090000Z",
      `RRULE:${rule}`,
    ]);
    assert.equal(parseIcs(byPart, FROM, TO).partial, true, rule);
  }
  const leapDay = ics([
    "UID:leap-day",
    "DTSTART:20160229T090000Z",
    "RRULE:FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29;COUNT=4",
  ]);
  assert.equal(parseIcs(leapDay, FROM, TO).partial, true);
  const other = ics([
    "UID:hourly",
    "DTSTART:20100105T090000Z",
    "RRULE:FREQ=HOURLY;COUNT=2",
  ]);
  assert.equal(parseIcs(other, FROM, TO).partial, true);
});

test("an override or RDATE in the window of a skipped series that ended marks the pull partial", () => {
  const moved = ics(
    [
      "UID:ended",
      "DTSTART:20260101T090000Z",
      "RRULE:FREQ=MONTHLY;UNTIL=20261001T000000Z",
    ],
    ["UID:ended", "RECURRENCE-ID:20260901T090000Z", "DTSTART:20261021T090000Z"],
  );
  const result = parseIcs(moved, FROM, TO);
  assert.deepEqual(result.events, []);
  assert.equal(result.partial, true);
  const outside = ics(
    [
      "UID:ended",
      "DTSTART:20260101T090000Z",
      "RRULE:FREQ=MONTHLY;UNTIL=20261001T000000Z",
    ],
    ["UID:ended", "RECURRENCE-ID:20260901T090000Z", "DTSTART:20260902T090000Z"],
  );
  assert.equal(parseIcs(outside, FROM, TO).partial, false);
  const rdate = ics([
    "UID:ended-rdate",
    "DTSTART:20260101T090000Z",
    "RRULE:FREQ=MONTHLY;UNTIL=20261001T000000Z",
    "RDATE:20261021T090000Z",
  ]);
  assert.equal(parseIcs(rdate, FROM, TO).partial, true);
});

test("a PERIOD RDATE is read by its start", () => {
  const old = ics([
    "UID:period-old",
    "DTSTART:20100105T090000Z",
    "RDATE;VALUE=PERIOD:20120105T090000Z/20120105T100000Z",
  ]);
  assert.equal(parseIcs(old, FROM, TO).partial, false);
  const inWindow = ics([
    "UID:period-new",
    "DTSTART:20100105T090000Z",
    "RDATE;VALUE=PERIOD:20261021T090000Z/PT1H",
  ]);
  assert.equal(parseIcs(inWindow, FROM, TO).partial, true);
});

test("an override of a skipped series is dropped with its series", () => {
  const text = ics(
    ["UID:m", "DTSTART:20261020T090000Z", "RRULE:FREQ=MONTHLY"],
    ["UID:m", "RECURRENCE-ID:20261120T090000Z", "DTSTART:20261104T090000Z"],
  );
  const result = parseIcs(text, FROM, TO);
  assert.deepEqual(result.events, []);
  assert.equal(result.partial, true);
});

test("a VEVENT without a UID is skipped, and a UID-less override touches no series", () => {
  const text = ics(
    ["DTSTART:20261102T150000Z", "SUMMARY:One"],
    ["UID: ", "DTSTART:20261102T150000Z", "SUMMARY:Two"],
    ["DTSTART:20261103T090000Z", "RRULE:FREQ=DAILY;COUNT=2"],
    ["RECURRENCE-ID:20261103T090000Z", "DTSTART:20261105T090000Z"],
    ["UID:kept", "DTSTART:20261102T150000Z", "SUMMARY:Kept"],
  );
  const result = parseIcs(text, FROM, TO);
  assert.deepEqual(
    result.events.map((e) => e.title),
    ["Kept"],
  );
  assert.equal(result.partial, false);
});

test("a feed with thousands of series and moved instances parses without a quadratic scan", () => {
  const events: string[][] = [];
  for (let i = 0; i < 6000; i += 1) {
    events.push([
      `UID:s${i}`,
      "DTSTART:20261019T090000Z",
      "RRULE:FREQ=WEEKLY;COUNT=2",
    ]);
    events.push([
      `UID:s${i}`,
      "RECURRENCE-ID:20261026T090000Z",
      "DTSTART:20261026T100000Z",
    ]);
  }
  const started = performance.now();
  const result = parseIcs(ics(...events), FROM, TO);
  assert.equal(result.events.length, 12000);
  assert.ok(performance.now() - started < 1500);
});

test("a cancelled series drops its moved instances too", () => {
  const feed = ics(
    [
      "UID:gone",
      "DTSTART:20261020T090000Z",
      "RRULE:FREQ=DAILY",
      "STATUS:CANCELLED",
      "SUMMARY:Standup",
    ],
    [
      "UID:gone",
      "RECURRENCE-ID:20261103T090000Z",
      "DTSTART:20261103T110000Z",
      "SUMMARY:Standup",
    ],
  );
  assert.deepEqual(parseIcs(feed, FROM, TO).events, []);
});

test("a weekly COUNT=20 or COUNT=100 series from 2015 has ended and is absent from a 2026 window", () => {
  for (const count of [20, 100]) {
    const feed = ics([
      `UID:count-${count}`,
      "DTSTART:20150105T090000Z",
      `RRULE:FREQ=WEEKLY;COUNT=${count}`,
    ]);
    const result = parseIcs(feed, FROM, TO);
    assert.deepEqual(result.events, [], `COUNT=${count}`);
    assert.equal(result.partial, false, `COUNT=${count}`);
  }
});

test("an override without its own SUMMARY, URL or DESCRIPTION takes them from its series", () => {
  const feed = ics(
    [
      "UID:s",
      "DTSTART:20261019T090000Z",
      "DTEND:20261019T093000Z",
      "RRULE:FREQ=WEEKLY;COUNT=3",
      "SUMMARY:Planning",
      "URL:https://meet.example.com/plan",
      "DESCRIPTION:Agenda LOCAL-12",
    ],
    [
      "UID:s",
      "RECURRENCE-ID:20261026T090000Z",
      "DTSTART:20261026T140000Z",
      "DTEND:20261026T143000Z",
    ],
  );
  const moved = parseIcs(feed, FROM, TO).events.find(
    (e) => e.start === "2026-10-26T14:00:00.000Z",
  );
  assert.equal(moved?.title, "Planning");
  assert.equal(moved?.url, "https://meet.example.com/plan");
  assert.equal(moved?.notes, "Agenda LOCAL-12");
  assert.equal(moved?.end, "2026-10-26T14:30:00.000Z");
});

test("a three-day all-day event spans all three days", () => {
  const feed = ics([
    "UID:offsite",
    "DTSTART;VALUE=DATE:20261104",
    "DTEND;VALUE=DATE:20261107",
  ]);
  const [event] = parseIcs(feed, FROM, TO).events;
  assert.equal(event.allDay, true);
  assert.equal(event.start, new Date(2026, 10, 4).toISOString());
  assert.equal(event.end, new Date(2026, 10, 7).toISOString());
});

test("BYDAY=MO,MO yields one instance per Monday", () => {
  const feed = ics([
    "UID:dup",
    "DTSTART:20261019T090000Z",
    "RRULE:FREQ=WEEKLY;BYDAY=MO,MO",
  ]);
  assert.deepEqual(starts(feed, FROM, new Date("2026-11-03T00:00:00Z")), [
    "2026-10-19T09:00:00.000Z",
    "2026-10-26T09:00:00.000Z",
    "2026-11-02T09:00:00.000Z",
  ]);
});
