import type {
  CalendarChoice,
  CalendarMode,
  CalendarSettingsPatch,
} from "../../../../shared/types.js";

export const CALENDAR_MODE_LABELS: Record<CalendarMode, string> = {
  macos: "This Mac's Calendar",
  ical: "iCal URL",
};

/**
 * Keep the first calendar of each title.
 *
 * @remarks Selection is stored by title (U4-03), so two calendars with one title would be two
 * checkboxes that always toggle together.
 */
export function uniqueChoices(
  loaded: readonly CalendarChoice[],
): CalendarChoice[] {
  const seen = new Set<string>();
  return loaded.filter((choice) => {
    if (seen.has(choice.title)) return false;
    seen.add(choice.title);
    return true;
  });
}

/**
 * The picks after a Load.
 *
 * @remarks
 * A first load with nothing saved picks the calendars not ignored by default. Any other load keeps
 * the current picks that are still in the loaded list.
 */
export function selectionAfterLoad(
  loaded: readonly CalendarChoice[],
  selected: ReadonlySet<string>,
  previous: readonly CalendarChoice[] | null,
  saved: readonly string[],
): ReadonlySet<string> {
  if (previous === null && saved.length === 0) {
    return new Set(
      loaded.filter((c) => !c.ignoredByDefault).map((c) => c.title),
    );
  }
  const titles = new Set(loaded.map((c) => c.title));
  return new Set([...selected].filter((title) => titles.has(title)));
}

/**
 * The settings patch for Connect or Save.
 *
 * @remarks Calendars are sent only once the list was loaded, so saving without loading keeps the
 * saved selection. With nothing saved, picks that equal the default are sent as [], which the reader
 * reads as every calendar not ignored (U4-02), so a Mac with more than 50 calendars still connects.
 */
export function settingsDraft(
  mode: CalendarMode,
  choices: readonly CalendarChoice[] | null,
  selected: ReadonlySet<string>,
  saved: readonly string[],
): CalendarSettingsPatch {
  if (mode !== "macos" || choices === null) return { mode };
  if (saved.length > 0) return { mode, calendars: [...selected] };
  const defaults = choices.filter((c) => !c.ignoredByDefault);
  const isDefault =
    selected.size === defaults.length &&
    defaults.every((c) => selected.has(c.title));
  return { mode, calendars: isDefault ? [] : [...selected] };
}
