import { useEffect, useState } from "react";
import type { Card, Item } from "../../../../shared/types.js";
import {
  CALENDAR_ERROR_COPY,
  CALENDAR_LOAD_FAILED_COPY,
} from "../../../../shared/connection-status.js";
import { ErrorAlert } from "@/components/ErrorAlert";
import { PageColumn } from "@/components/PageColumn";
import { AgendaRowContainer } from "./AgendaRowContainer";
import { CalendarAgenda } from "@/modules/calendar/components/CalendarAgenda";
import { CalendarOff } from "@/modules/calendar/components/CalendarOff";
import { agendaDays } from "@/modules/calendar/domain/calendar-agenda";
import {
  CALENDAR_POLL_MS,
  useCalendarPollQuery,
} from "@/modules/calendar/queries/calendar-queries";

interface CalendarContainerProps {
  items: Item[];
  cards: Card[];
  services: {
    notice: (message: string) => void;
    openUrl: (url: string) => void;
  };
  onStartPromoted: (cardId: string) => void;
  onOpenSettings: () => void;
}

export function CalendarContainer({
  items,
  cards,
  services,
  onStartPromoted,
  onOpenSettings,
}: CalendarContainerProps) {
  const { data: status, isError: loadFailed } = useCalendarPollQuery();
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), CALENDAR_POLL_MS);
    return () => clearInterval(id);
  }, []);

  const loadFailedNotice = loadFailed && (
    <ErrorAlert>{CALENDAR_LOAD_FAILED_COPY}</ErrorAlert>
  );
  if (status === undefined) {
    return loadFailed ? <PageColumn>{loadFailedNotice}</PageColumn> : null;
  }
  if (!status.enabled) {
    return (
      <CalendarOff notice={loadFailedNotice} onOpenSettings={onOpenSettings} />
    );
  }
  return (
    <PageColumn>
      {loadFailedNotice}
      {status.lastError !== undefined && (
        <ErrorAlert>{CALENDAR_ERROR_COPY[status.lastError]}</ErrorAlert>
      )}
      <CalendarAgenda
        days={agendaDays(items, now)}
        renderRow={(item) => (
          <AgendaRowContainer
            key={item.id}
            item={item}
            now={now}
            cards={cards}
            onJoin={services.openUrl}
            onNotice={services.notice}
            onStartPromoted={onStartPromoted}
          />
        )}
      />
    </PageColumn>
  );
}
