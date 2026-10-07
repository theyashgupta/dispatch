import { useEffect, useMemo, useState } from "react";
import { useRouteContext, useRouter } from "@tanstack/react-router";
import { routeHash } from "../../../../shared/route.js";
import type { Card, Item } from "../../../../shared/types.js";
import {
  CALENDAR_ERROR_COPY,
  CALENDAR_LOAD_FAILED_COPY,
} from "../../../../shared/connection-status.js";
import { ErrorAlert } from "@/components/ErrorAlert";
import { PageColumn } from "@/components/PageColumn";
import { useAppStore } from "@/components/ui/hooks/use-app-store";
import { useItems } from "@/components/ui/hooks/use-items";
import { actionServices } from "@/queries/action-services";
import { useBoardSnapshot } from "@/queries/board-snapshot-queries";
import { AgendaRowContainer } from "./AgendaRowContainer";
import { CalendarAgenda } from "@/modules/calendar/components/CalendarAgenda";
import { CalendarOff } from "@/modules/calendar/components/CalendarOff";
import { agendaDays } from "@/modules/calendar/domain/calendar-agenda";
import {
  CALENDAR_POLL_MS,
  useCalendarPollQuery,
} from "@/modules/calendar/queries/calendar-queries";

interface CalendarPageProps {
  items: Item[];
  cards: Card[];
  services: {
    notice: (message: string) => void;
    openUrl: (url: string) => void;
  };
  onStartPromoted: (cardId: string) => void;
  onOpenSettings: () => void;
}

export function CalendarContainer() {
  const { appStore } = useRouteContext({ from: "__root__" });
  const router = useRouter();
  const board = useBoardSnapshot(useAppStore(appStore, (s) => s.doneLimit));
  const items = useItems(board);
  const services = useMemo(
    () =>
      actionServices({
        showUndo: appStore.showUndo,
        notice: appStore.notice,
        openStart: appStore.openStart,
        askAbout: (question) =>
          void router.navigate({
            href: routeHash({ page: "ask", id: question }).slice(1),
          }),
      }),
    [appStore, router],
  );
  if (board == null) return null;
  return (
    <CalendarPage
      items={items}
      cards={board.cards}
      services={services}
      onStartPromoted={(cardId) => appStore.openStart({ cardId })}
      onOpenSettings={() =>
        void router.navigate({ href: routeHash({ page: "settings" }).slice(1) })
      }
    />
  );
}

function CalendarPage({
  items,
  cards,
  services,
  onStartPromoted,
  onOpenSettings,
}: CalendarPageProps) {
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
