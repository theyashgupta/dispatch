import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import vm from "node:vm";
import { isolateEnv } from "../test-support/fixtures.js";

const env = isolateEnv();
const stubDir = path.join(env.root, "osascript-stub");
fs.mkdirSync(stubDir);
process.env.STUB_DIR = stubDir;

const EVENTS = JSON.stringify({
  events: [
    {
      uid: "u1",
      title: "Design sync",
      start: "2026-11-02T15:00:00.000Z",
      end: "2026-11-02T15:30:00.000Z",
      allDay: false,
      location: "Room 4",
      url: "https://meet.google.com/abc",
      notes: "LOCAL-12",
      calendar: "Work",
    },
    {
      uid: "",
      title: "no uid",
      start: "x",
      end: "y",
      allDay: false,
      calendar: "Work",
    },
  ],
});

fs.writeFileSync(
  path.join(env.binDir, "osascript"),
  [
    "#!/bin/sh",
    'printf "%s\\n" "$@" > "$STUB_DIR/argv.txt"',
    'cat > "$STUB_DIR/stdin.txt"',
    'mode=$(cat "$STUB_DIR/mode" 2>/dev/null || echo ok)',
    'case "$mode" in',
    `ok) printf '%s' '${EVENTS}' ;;`,
    `denied) printf '%s' '{"error":"calendar-denied"}' ;;`,
    'stderr) echo "execution error: Not authorized to send Apple events to Calendar. (-1743)" >&2; exit 1 ;;',
    "garbage) echo 'osascript: something odd' ;;",
    "slow) exec sleep 60 ;;",
    'file) cat "$STUB_DIR/out.json" ;;',
    "esac",
  ].join("\n"),
  { mode: 0o755 },
);

const { readMacEvents, parseMacOutput, osascriptError, EVENTS_SCRIPT } =
  await import("./calendar-mac.js");
const { run } = await import("./exec.js");
const { CalendarReadError } =
  await import("../sources/calendar/calendar-events.js");

function mode(value: string): void {
  fs.writeFileSync(path.join(stubDir, "mode"), value);
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

const FROM = new Date("2026-11-02T00:00:00.000Z");
const TO = new Date("2026-11-04T00:00:00.000Z");

test("the script goes on stdin and the calendars travel only inside one JSON argv element", async () => {
  mode("ok");
  const titles = ['Work"; do shell script "rm x', "Home"];
  const { events, partial } = await readMacEvents(FROM, TO, titles);
  assert.equal(partial, false);
  assert.deepEqual(
    events.map((e) => e.uid),
    ["u1"],
  );
  assert.equal(events[0].notes, "LOCAL-12");
  const argv = fs
    .readFileSync(path.join(stubDir, "argv.txt"), "utf8")
    .trimEnd()
    .split("\n");
  assert.deepEqual(argv.slice(0, 3), ["-l", "JavaScript", "-"]);
  assert.equal(argv.length, 4);
  const args = JSON.parse(argv[3]) as {
    from: string;
    to: string;
    calendars: string[];
  };
  assert.deepEqual(args.calendars, titles);
  assert.equal(args.from, FROM.toISOString());
  const script = fs.readFileSync(path.join(stubDir, "stdin.txt"), "utf8");
  assert.match(script, /EKEventStore/);
  assert.equal(script.includes("Home"), false);
  assert.equal(script.includes("rm x"), false);
});

test("denied output and a -1743 stderr both map to calendar-denied without the stderr text", async () => {
  mode("denied");
  assert.equal(await codeOf(readMacEvents(FROM, TO, [])), "calendar-denied");
  mode("stderr");
  assert.equal(await codeOf(readMacEvents(FROM, TO, [])), "calendar-denied");
});

test("garbage output maps to failed and a slow reader is killed at the timeout", async () => {
  mode("garbage");
  assert.equal(await codeOf(readMacEvents(FROM, TO, [])), "failed");
  mode("slow");
  const started = Date.now();
  assert.equal(await codeOf(readMacEvents(FROM, TO, [], 300)), "timeout");
  assert.ok(Date.now() - started < 10_000);
});

test("only a child killed by the deadline maps to timeout", () => {
  assert.equal(osascriptError({ killed: true }), "timeout");
  assert.equal(osascriptError({ killed: false }), "failed");
  assert.equal(osascriptError({}), "failed");
});

test("an answer over Node's 1 MB default buffer still reads", async () => {
  const notes = "n".repeat(3000);
  const events = Array.from({ length: 800 }, (_, i) => ({
    uid: `u${i}`,
    title: "Busy",
    start: "2026-11-02T15:00:00.000Z",
    end: "2026-11-02T15:30:00.000Z",
    allDay: false,
    notes,
    calendar: "Work",
  }));
  fs.writeFileSync(path.join(stubDir, "out.json"), JSON.stringify({ events }));
  mode("file");
  assert.equal((await readMacEvents(FROM, TO, [])).events.length, 800);
});

const NIL = { isNil: () => true };

/** A JXA-style ObjC value: a wrapped NSString, or the nil proxy when absent. */
function ns(value: string | undefined): { isNil: () => boolean; js?: string } {
  return value === undefined ? NIL : { isNil: () => false, js: value };
}

/** ObjC.unwrap as JXA does it: a wrapped string gives its text, nil gives undefined. */
function unwrap(value: unknown): unknown {
  if (value === NIL) return undefined;
  if (typeof value === "object" && value !== null && "js" in value) {
    return value.js;
  }
  return value;
}

interface FakeEvent {
  external?: string;
  identifier: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  url?: string;
  notes?: string;
  calendar: string;
}

/** An EKEvent-shaped object as the ObjC bridge hands it to the script. */
function ekEvent(e: FakeEvent): Record<string, unknown> {
  return {
    calendarItemExternalIdentifier: ns(e.external),
    eventIdentifier: ns(e.identifier),
    title: ns(e.title),
    startDate: { timeIntervalSince1970: Date.parse(e.start) / 1000 },
    endDate: { timeIntervalSince1970: Date.parse(e.end) / 1000 },
    allDay: e.allDay,
    location: NIL,
    URL:
      e.url === undefined
        ? NIL
        : { isNil: () => false, absoluteString: ns(e.url) },
    notes: ns(e.notes),
    calendar: { title: ns(e.calendar) },
  };
}

/** Run the events script in a vm against a fake EventKit store, recording the calendars it queries. */
function runScriptIn(
  titles: string[],
  saved: string[],
  events: FakeEvent[] = [],
  queried: unknown[] = [],
): unknown {
  const store = {
    calendarsForEntityType: () => titles.map((title) => ({ title: ns(title) })),
    predicateForEventsWithStartDateEndDateCalendars: (
      _from: unknown,
      _to: unknown,
      calendars: { title: unknown }[],
    ) => {
      queried.push(...calendars.map((c) => unwrap(c.title)));
      return {};
    },
    eventsMatchingPredicate: () => events.map(ekEvent),
  };
  const sandbox = {
    ObjC: { import: () => undefined, unwrap },
    $: Object.assign((v: unknown) => v, {
      EKEventStore: {
        authorizationStatusForEntityType: () => 3,
        alloc: { init: store },
      },
      EKEntityTypeEvent: 0,
      NSDate: { dateWithTimeIntervalSince1970: () => ({}) },
    }),
  };
  const main = vm.runInNewContext(`${EVENTS_SCRIPT}\nrun;`, sandbox) as (
    argv: string[],
  ) => string;
  return JSON.parse(
    main([
      JSON.stringify({
        from: FROM.toISOString(),
        to: TO.toISOString(),
        calendars: saved,
        ignored: "birthday",
      }),
    ]),
  );
}

test("saved calendar titles that match no calendar answer an error, so the read fails instead of reading empty", () => {
  assert.deepEqual(runScriptIn(["Home"], ["Work"]), {
    error: "calendars-missing",
  });
  assert.throws(
    () => parseMacOutput('{"error":"calendars-missing"}'),
    /failed/,
  );
  assert.deepEqual(runScriptIn(["Birthdays"], []), { events: [] });
  assert.deepEqual(runScriptIn(["Work"], ["Work"]), {
    events: [],
    partial: false,
  });
});

test("when only some saved titles match, the script reads the rest and the answer is partial", () => {
  const answer = runScriptIn(["Work", "Family"], ["Work", "Home"]);
  assert.deepEqual(answer, { events: [], partial: true });
  assert.deepEqual(parseMacOutput(JSON.stringify(answer)), {
    events: [],
    partial: true,
  });
});

test("parseMacOutput keeps valid events, drops broken ones and cuts notes to 4000", () => {
  const long = "n".repeat(5000);
  const { events, partial } = parseMacOutput(
    JSON.stringify({
      events: [
        {
          uid: "a",
          title: "",
          start: "2026-11-02T15:00:00Z",
          end: "2026-11-02T16:00:00Z",
          allDay: true,
          calendar: "Home",
          notes: long,
        },
        {
          uid: "b",
          title: "x",
          start: "not a date",
          end: "2026-11-02T16:00:00Z",
          allDay: false,
          calendar: "Home",
        },
        null,
      ],
    }),
  );
  assert.deepEqual(
    events.map((e) => e.uid),
    ["a"],
  );
  assert.equal(events[0].notes?.length, 4000);
  assert.equal(partial, false);
  assert.throws(() => parseMacOutput('{"events":"no"}'), /failed/);
  assert.throws(
    () => parseMacOutput('{"error":"calendar-denied"}'),
    /calendar-denied/,
  );
});

test(
  "the reader script compiles and answers its self-test under the real osascript",
  { skip: !fs.existsSync("/usr/bin/osascript") },
  async () => {
    const { stdout } = await run(
      "/usr/bin/osascript",
      ["-l", "JavaScript", "-", JSON.stringify({ selftest: true })],
      { input: EVENTS_SCRIPT, timeout: 30_000 },
    );
    assert.equal(stdout.trim(), '{"selftest":"ok"}');
  },
);

test("the script maps EKEvents with the uid fallback, allDay, URL, cut notes and queries only the selected calendars", () => {
  const events: FakeEvent[] = [
    {
      identifier: "local-id-1",
      title: "Offsite",
      start: "2026-11-02T00:00:00.000Z",
      end: "2026-11-03T00:00:00.000Z",
      allDay: true,
      calendar: "Work",
    },
    {
      external: "ext-2",
      identifier: "local-id-2",
      title: "Design sync",
      start: "2026-11-02T15:00:00.000Z",
      end: "2026-11-02T15:30:00.000Z",
      allDay: false,
      url: "https://meet.google.com/abc",
      notes: "n".repeat(5000),
      calendar: "Work",
    },
  ];
  const queried: unknown[] = [];
  const answer = runScriptIn(
    ["Work", "Home", "Birthdays"],
    ["Work"],
    events,
    queried,
  ) as { events: Record<string, unknown>[]; partial: boolean };
  assert.deepEqual(queried, ["Work"]);
  assert.equal(answer.partial, false);
  const [allDay, timed] = answer.events;
  assert.deepEqual(allDay, {
    uid: "local-id-1",
    title: "Offsite",
    start: "2026-11-02T00:00:00.000Z",
    end: "2026-11-03T00:00:00.000Z",
    allDay: true,
    calendar: "Work",
  });
  assert.equal(timed.uid, "ext-2");
  assert.equal(timed.allDay, false);
  assert.equal(timed.url, "https://meet.google.com/abc");
  assert.equal((timed.notes as string).length, 4000);
  assert.equal(timed.calendar, "Work");
  const defaults: unknown[] = [];
  runScriptIn(["Work", "Home", "Birthdays"], [], [], defaults);
  assert.deepEqual(defaults, ["Work", "Home"]);
});
