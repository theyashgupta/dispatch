import type { ReactNode } from "react";
import type { Item } from "../../../../shared/types.js";
import type { AgendaDay } from "@/modules/calendar/domain/calendar-agenda";

interface CalendarAgendaProps {
  days: AgendaDay[];
  renderRow: (item: Item) => ReactNode;
}

export function CalendarAgenda({ days, renderRow }: CalendarAgendaProps) {
  if (days.length === 0) {
    return (
      <span className="text-sm wrap-anywhere text-muted-foreground">
        Nothing in the next 48 hours.
      </span>
    );
  }
  return (
    <>
      {days.map((day) => (
        <section key={day.key} aria-label={day.label}>
          <h2 className="mb-1 text-sm font-medium text-muted-foreground">
            {day.label}
          </h2>
          <ul className="m-0 grid list-none grid-cols-[minmax(0,1fr)] gap-1 p-0">
            {day.items.map(renderRow)}
          </ul>
        </section>
      ))}
    </>
  );
}
