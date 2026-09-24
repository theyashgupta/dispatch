import type { ActivityEvent, EventType } from "../../../shared/types.js";

export interface ActivityFilter {
  cardId: string | null;
  types: EventType[];
}

interface DayGroup {
  label: string;
  dayKey: string;
  events: ActivityEvent[];
}

/** Keeps the events that match the selected card (when set) and the selected types (when any). */
export function filterEvents(
  events: readonly ActivityEvent[],
  filter: ActivityFilter,
): ActivityEvent[] {
  return events.filter(
    (event) =>
      (filter.cardId === null || event.cardId === filter.cardId) &&
      (filter.types.length === 0 || filter.types.includes(event.type)),
  );
}

function dayKeyOf(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * Groups events by local calendar day in feed order, labelling today, yesterday and older days.
 * @remarks Keys come from the local date parts, so an event at 23:59 and one at 00:01 never share
 * a group across midnight, and the label is decided against `now` rather than the clock at render.
 */
export function groupEventsByDay(
  events: readonly ActivityEvent[],
  now: number,
): DayGroup[] {
  const todayKey = dayKeyOf(new Date(now));
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = dayKeyOf(yesterday);
  const groups: DayGroup[] = [];
  const byKey = new Map<string, DayGroup>();
  for (const event of events) {
    const date = new Date(event.ts);
    const dayKey = dayKeyOf(date);
    let group = byKey.get(dayKey);
    if (!group) {
      const label =
        dayKey === todayKey
          ? "Today"
          : dayKey === yesterdayKey
            ? "Yesterday"
            : date.toLocaleDateString(undefined, {
                year: "numeric",
                month: "short",
                day: "numeric",
              });
      group = { label, dayKey, events: [] };
      byKey.set(dayKey, group);
      groups.push(group);
    }
    group.events.push(event);
  }
  return groups;
}
