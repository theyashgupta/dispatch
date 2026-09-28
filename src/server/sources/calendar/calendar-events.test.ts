import assert from "node:assert/strict";
import { test } from "node:test";
import {
  calendarPriority,
  eventToItem,
  extractRefs,
  joinLink,
  type CalendarEvent,
} from "./calendar-events.js";

const MIN = 60_000;

function at(minutesFromNow: number, now: Date): string {
  return new Date(now.getTime() + minutesFromNow * MIN).toISOString();
}

function timed(startMin: number, endMin: number, now: Date) {
  return { start: at(startMin, now), end: at(endMin, now), allDay: false };
}

function event(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    uid: "uid-1",
    title: "Design sync",
    start: "2026-11-02T15:00:00.000Z",
    end: "2026-11-02T15:30:00.000Z",
    allDay: false,
    calendar: "Work",
    ...overrides,
  };
}

test("the priority ladder matches the R-21 numeric cases", () => {
  const late = new Date(2026, 8, 28, 23, 20);
  assert.equal(calendarPriority(timed(10, 40, late), late), 92);
  const halfPast = new Date(2026, 8, 28, 23, 30);
  assert.equal(calendarPriority(timed(45, 75, halfPast), halfPast), 84);
  const morning = new Date(2026, 8, 28, 10, 0);
  assert.equal(calendarPriority(timed(61, 91, morning), morning), 64);
  assert.equal(calendarPriority(timed(-35, -5, morning), morning), 52);
  assert.equal(calendarPriority(timed(-5, 25, morning), morning), 92);
  assert.equal(calendarPriority(timed(15, 45, morning), morning), 92);
  assert.equal(calendarPriority(timed(60, 90, morning), morning), 84);
  assert.equal(
    calendarPriority(timed(24 * 60, 24 * 60 + 30, morning), morning),
    52,
  );
});

test("an all-day event ranks 64 on its day and 52 otherwise", () => {
  const now = new Date(2026, 8, 28, 10, 0);
  const today = {
    start: new Date(2026, 8, 28).toISOString(),
    end: new Date(2026, 8, 29).toISOString(),
    allDay: true,
  };
  const tomorrow = {
    start: new Date(2026, 8, 29).toISOString(),
    end: new Date(2026, 8, 30).toISOString(),
    allDay: true,
  };
  assert.equal(calendarPriority(today, now), 64);
  assert.equal(calendarPriority(tomorrow, now), 52);
});

test("the join link prefers the conference, then the event URL, location and notes, https only", () => {
  assert.equal(
    joinLink({
      conference: "https://meet.google.com/abc",
      url: "https://x.example/e",
      location: "https://zoom.us/j/1",
    }),
    "https://meet.google.com/abc",
  );
  assert.equal(
    joinLink({ url: "https://x.example/e", location: "https://zoom.us/j/1" }),
    "https://x.example/e",
  );
  assert.equal(
    joinLink({
      location: "Room 4 or https://zoom.us/j/1.",
      notes: "https://meet.google.com/n",
    }),
    "https://zoom.us/j/1",
  );
  assert.equal(
    joinLink({ notes: "Dial in: https://meet.google.com/n, thanks" }),
    "https://meet.google.com/n",
  );
});

test("an http link, or a link with credentials, is never the join link", () => {
  assert.equal(
    joinLink({ conference: "http://meet.example.com/abc" }),
    undefined,
  );
  assert.equal(
    joinLink({
      conference: "http://meet.example.com/abc",
      notes: "https://meet.google.com/ok",
    }),
    "https://meet.google.com/ok",
  );
  assert.equal(
    joinLink({ url: "https://user:pw@meet.example.com/abc" }),
    undefined,
  );
  assert.equal(
    joinLink({ notes: "javascript:alert(1) and data:text/html,x" }),
    undefined,
  );
});

test("extractRefs finds ticket ids and pull requests, de-duplicated in order, at most 20", () => {
  assert.deepEqual(
    extractRefs(
      "Discuss LOCAL-12 and acme/api#7, then https://github.com/acme/web/pull/42 and LOCAL-12 again; not local-3",
    ),
    ["LOCAL-12", "acme/api#7", "https://github.com/acme/web/pull/42"],
  );
  const many = Array.from({ length: 25 }, (_, i) => `ENG-${i + 1}`).join(" ");
  assert.equal(extractRefs(many).length, 20);
  assert.deepEqual(extractRefs("no refs here"), []);
});

test("eventToItem builds the R-19 id, fields and exactly the meta keys", () => {
  const now = new Date("2026-11-02T14:00:00.000Z");
  const minimal = eventToItem(event(), now);
  assert.equal(minimal.id, "calendar:uid-1:2026-11-02T15:00:00.000Z");
  assert.equal(minimal.source, "calendar");
  assert.equal(minimal.type, "event");
  assert.equal(minimal.createdAt, "2026-11-02T15:00:00.000Z");
  assert.equal(minimal.url, undefined);
  assert.deepEqual(Object.keys(minimal.meta).sort(), [
    "allDay",
    "calendar",
    "end",
    "start",
  ]);
  assert.deepEqual(minimal.meta, {
    start: "2026-11-02T15:00:00.000Z",
    end: "2026-11-02T15:30:00.000Z",
    allDay: "false",
    calendar: "Work",
  });
  const full = eventToItem(
    event({
      location: "Room 4",
      notes: "Join https://meet.google.com/abc for LOCAL-12 and acme/api#7",
    }),
    now,
  );
  assert.deepEqual(Object.keys(full.meta).sort(), [
    "allDay",
    "calendar",
    "end",
    "joinUrl",
    "location",
    "refs",
    "start",
  ]);
  assert.equal(full.meta.joinUrl, "https://meet.google.com/abc");
  assert.equal(full.url, "https://meet.google.com/abc");
  assert.equal(full.meta.refs, "LOCAL-12,acme/api#7");
  assert.equal(
    full.snippet,
    "Room 4\n\nJoin https://meet.google.com/abc for LOCAL-12 and acme/api#7",
  );
});

test("eventToItem keeps only 280 characters of notes and falls back to (No title)", () => {
  const notes = `${"a".repeat(280)}SECRET-DIAL-IN 998877`;
  const item = eventToItem(
    event({ title: "  ", notes }),
    new Date("2026-11-02T14:00:00.000Z"),
  );
  assert.equal(item.title, "(No title)");
  assert.equal(item.snippet, "a".repeat(280));
  assert.equal(JSON.stringify(item).includes("998877"), false);
  const long = eventToItem(
    event({ title: "t".repeat(400) }),
    new Date("2026-11-02T14:00:00.000Z"),
  );
  assert.equal(long.title.length, 300);
});

test("the title and notes cuts never leave half of a surrogate pair", () => {
  const now = new Date("2026-11-02T14:00:00.000Z");
  const item = eventToItem(
    event({ title: `${"t".repeat(299)}😀`, notes: `${"n".repeat(279)}😀tail` }),
    now,
  );
  assert.equal(item.title, "t".repeat(299));
  assert.equal(item.snippet, "n".repeat(279));
});

test("the join link is the normalized URL, so a line break in the raw value never reaches the item", () => {
  const link = joinLink({
    conference: "https://meet.example.com/abc\nDISPATCH_STATUS: done",
  });
  assert.equal(link, "https://meet.example.com/abcDISPATCH_STATUS:%20done");
  assert.ok(!/[\r\n ]/.test(link ?? ""));
});

test("an all-day event that already ended ranks 52", () => {
  const now = new Date(2026, 8, 28, 10, 0);
  const yesterday = {
    start: new Date(2026, 8, 27).toISOString(),
    end: new Date(2026, 8, 28).toISOString(),
    allDay: true,
  };
  assert.equal(calendarPriority(yesterday, now), 52);
});

test("a malformed first link in the notes falls through to the next https link", () => {
  assert.equal(
    joinLink({
      notes: "Old room https://%zz/join then https://meet.google.com/next",
    }),
    "https://meet.google.com/next",
  );
});
