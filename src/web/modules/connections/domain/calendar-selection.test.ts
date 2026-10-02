import assert from "node:assert/strict";
import { test } from "node:test";
import type { CalendarChoice } from "../../../../shared/types.js";
import {
  selectionAfterLoad,
  settingsDraft,
  uniqueChoices,
} from "./calendar-selection.js";

const work: CalendarChoice = {
  title: "Work",
  source: "iCloud",
  ignoredByDefault: false,
};
const home: CalendarChoice = {
  title: "Home",
  source: "iCloud",
  ignoredByDefault: false,
};
const holidays: CalendarChoice = {
  title: "UK Holidays",
  source: "Subscribed",
  ignoredByDefault: true,
};

test("calendars are sent only after the list was loaded, and never in iCal mode", () => {
  assert.deepEqual(settingsDraft("macos", null, new Set(["Work"]), []), {
    mode: "macos",
  });
  assert.deepEqual(settingsDraft("ical", [work, home], new Set(["Work"]), []), {
    mode: "ical",
  });
  assert.deepEqual(
    settingsDraft("macos", [work, home], new Set(["Work"]), []),
    {
      mode: "macos",
      calendars: ["Work"],
    },
  );
});

test("default-equal picks stay an explicit list when a list was saved before", () => {
  assert.deepEqual(
    settingsDraft("macos", [work, home, holidays], new Set(["Work", "Home"]), [
      "Work",
      "Home",
    ]),
    { mode: "macos", calendars: ["Work", "Home"] },
  );
});

test("with nothing saved, picks equal to the default selection are sent as an empty list", () => {
  const choices = [work, home, holidays];
  assert.deepEqual(
    settingsDraft("macos", choices, new Set(["Work", "Home"]), []),
    {
      mode: "macos",
      calendars: [],
    },
  );
  assert.deepEqual(
    settingsDraft(
      "macos",
      choices,
      new Set(["Work", "Home", "UK Holidays"]),
      [],
    ),
    { mode: "macos", calendars: ["Work", "Home", "UK Holidays"] },
  );
});

test("a first load with nothing saved checks every calendar except the default-ignored ones", () => {
  assert.deepEqual(
    [...selectionAfterLoad([work, home, holidays], new Set(), null, [])],
    ["Work", "Home"],
  );
});

test("a second load before Save keeps the user's changed picks instead of resetting to the default", () => {
  assert.deepEqual(
    [
      ...selectionAfterLoad(
        [work, home, holidays],
        new Set(["Home"]),
        [work, home, holidays],
        [],
      ),
    ],
    ["Home"],
  );
});

test("a load with a saved selection keeps it and drops titles that are no longer listed", () => {
  const picks = new Set(["Work", "Renamed away", "UK Holidays"]);
  assert.deepEqual(
    [...selectionAfterLoad([work, home, holidays], picks, null, [...picks])],
    ["Work", "UK Holidays"],
  );
});

test("two calendars with one title give one checkbox row", () => {
  const google: CalendarChoice = {
    title: "Work",
    source: "Google",
    ignoredByDefault: false,
  };
  assert.deepEqual(uniqueChoices([work, google, home]), [work, home]);
});
