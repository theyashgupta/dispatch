import { useState } from "react";
import { calendarCardStatus } from "../../../../shared/connection-status.js";
import type {
  CalendarChoice,
  CalendarErrorCode,
  CalendarMode,
  CalendarSettingsPatch,
} from "../../../../shared/types.js";
import { CalendarCard } from "@/modules/connections/components/CalendarCard";
import { calendarAccessView } from "@/modules/connections/domain/calendar-permission";
import {
  selectionAfterLoad,
  settingsDraft,
  uniqueChoices,
} from "@/modules/connections/domain/calendar-selection";
import {
  useCalendarConnectionStatusQuery,
  useCheckCalendarAccessMutation,
  useListCalendarsMutation,
  useSaveCalendarSettingsMutation,
} from "@/modules/connections/queries/connections-queries";

export function CalendarContainer() {
  const statusQuery = useCalendarConnectionStatusQuery();
  const list = useListCalendarsMutation();
  const saveSettings = useSaveCalendarSettingsMutation();
  const checkAccess = useCheckCalendarAccessMutation();
  const status = statusQuery.data ?? null;
  const [initialized, setInitialized] = useState(false);
  const [mode, setMode] = useState<CalendarMode>("macos");
  const [choices, setChoices] = useState<CalendarChoice[] | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [actionError, setActionError] = useState<CalendarErrorCode | null>(
    null,
  );

  if (!initialized && statusQuery.isFetchedAfterMount && statusQuery.data) {
    setInitialized(true);
    setMode(statusQuery.data.mode);
    setSelected(new Set(statusQuery.data.calendars));
  }

  const loadCalendars = async () => {
    const previous = choices;
    const saved = status?.calendars ?? [];
    setActionError(null);
    try {
      const result = await list.mutateAsync();
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
    }
  };

  const checkCalendarAccess = async () => {
    setActionError(null);
    try {
      const result = await checkAccess.mutateAsync();
      if (!result.ok) setActionError(result.error);
    } catch {
      setActionError("failed");
    }
  };

  const send = async (patch: CalendarSettingsPatch) => {
    setActionError(null);
    try {
      const result = await saveSettings.mutateAsync(patch);
      if (!result.ok) setActionError(result.error);
    } catch {
      setActionError("failed");
    }
  };

  const patch = settingsDraft(mode, choices, selected, status?.calendars ?? []);

  return (
    <CalendarCard
      status={calendarCardStatus(status, actionError, statusQuery.isError)}
      mode={mode}
      busy={saveSettings.isPending}
      loadingChoices={list.isPending}
      choices={choices}
      selected={selected}
      icalFilled={status?.icalFilled === true}
      enabled={status?.enabled === true}
      statusKnown={status !== null}
      access={status === null ? null : calendarAccessView(status, new Date())}
      checkingAccess={checkAccess.isPending}
      onModeChange={(next) => {
        setActionError(null);
        setMode(next);
      }}
      onCheckAccess={() => void checkCalendarAccess()}
      onLoad={() => void loadCalendars()}
      onToggle={(title) =>
        setSelected((current) => {
          const next = new Set(current);
          if (next.has(title)) next.delete(title);
          else next.add(title);
          return next;
        })
      }
      onSave={() => void send(patch)}
      onConnect={() => void send({ ...patch, enabled: true })}
      onDisconnect={() => void send({ enabled: false })}
    />
  );
}
