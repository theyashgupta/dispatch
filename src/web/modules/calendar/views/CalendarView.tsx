import type { ComponentProps } from "react";
import { CalendarContainer } from "@/modules/calendar/containers/CalendarContainer";

export function CalendarView(props: ComponentProps<typeof CalendarContainer>) {
  return <CalendarContainer {...props} />;
}
