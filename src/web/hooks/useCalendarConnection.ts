import { useEffect, useState } from "react";
import type {
  CalendarChoice,
  CalendarErrorCode,
  CalendarMode,
  CalendarSettingsPatch,
  CalendarStatus,
} from "../../shared/types.js";
import {
  getCalendarStatus,
  listCalendars,
  putCalendarSettings,
} from "../lib/api.js";

export interface CalendarConnectionState {
  status: CalendarStatus | null;
  loadFailed: boolean;
  busy: boolean;
  actionError: CalendarErrorCode | null;
  mode: CalendarMode;
  choices: CalendarChoice[] | null;
  selected: ReadonlySet<string>;
  loadingChoices: boolean;
  setMode: (mode: CalendarMode) => void;
  toggle: (title: string) => void;
  loadCalendars: () => Promise<void>;
  connect: () => Promise<void>;
  save: () => Promise<void>;
  disconnect: () => Promise<void>;
}

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
 * The picks after a Load: the calendars not ignored by default on a first load with nothing saved,
 * else the current picks that are still in the loaded list.
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

/**
 * The Calendar card's state: the saved status, the draft mode and calendar picks, and the actions.
 *
 * @remarks Picks stay a local draft until Connect or Save.
 */
export function useCalendarConnection(): CalendarConnectionState {
  const [status, setStatus] = useState<CalendarStatus | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<CalendarErrorCode | null>(
    null,
  );
  const [mode, setModeState] = useState<CalendarMode>("macos");
  const [choices, setChoices] = useState<CalendarChoice[] | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [loadingChoices, setLoadingChoices] = useState(false);

  useEffect(() => {
    getCalendarStatus().then(
      (next) => {
        setStatus(next);
        setModeState(next.mode);
        setSelected(new Set(next.calendars));
      },
      () => setLoadFailed(true),
    );
  }, []);

  const loadCalendars = async () => {
    const previous = choices;
    const saved = status?.calendars ?? [];
    setLoadingChoices(true);
    setActionError(null);
    try {
      const result = await listCalendars();
      if (!result.ok) {
        setActionError(result.error);
        return;
      }
      const loaded = uniqueChoices(result.value);
      setChoices(loaded);
      setSelected((current) =>
        selectionAfterLoad(loaded, current, previous, saved),
      );
    } catch {
      setActionError("failed");
    } finally {
      setLoadingChoices(false);
    }
  };

  const send = async (patch: CalendarSettingsPatch) => {
    setBusy(true);
    setActionError(null);
    try {
      const result = await putCalendarSettings(patch);
      if (result.ok) setStatus(result.value);
      else setActionError(result.error);
    } catch {
      setActionError("failed");
    } finally {
      setBusy(false);
    }
  };

  const patch = settingsDraft(mode, choices, selected, status?.calendars ?? []);

  return {
    status,
    loadFailed,
    busy,
    actionError,
    mode,
    choices,
    selected,
    loadingChoices,
    setMode: (next) => {
      setActionError(null);
      setModeState(next);
    },
    toggle: (title) =>
      setSelected((current) => {
        const next = new Set(current);
        if (next.has(title)) next.delete(title);
        else next.add(title);
        return next;
      }),
    loadCalendars,
    connect: () => send({ ...patch, enabled: true }),
    save: () => send(patch),
    disconnect: () => send({ enabled: false }),
  };
}
