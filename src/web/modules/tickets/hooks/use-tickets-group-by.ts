import { useState } from "react";
import {
  parseTicketsGroupBy,
  TICKETS_GROUP_BY_KEY,
  type TicketsGroupBy,
} from "@/modules/tickets/domain/ticket-rows";

function readStored(): TicketsGroupBy {
  try {
    return parseTicketsGroupBy(localStorage.getItem(TICKETS_GROUP_BY_KEY));
  } catch {
    return "status";
  }
}

/**
 * Hold the group-by choice and remember it across reloads.
 *
 * @remarks
 * The choice is stored as plain text, so a blocked storage keeps the page working and saves nothing.
 */
export function useTicketsGroupBy(): [
  TicketsGroupBy,
  (value: TicketsGroupBy) => void,
] {
  const [groupBy, setGroupBy] = useState(readStored);
  function change(value: TicketsGroupBy) {
    setGroupBy(value);
    try {
      localStorage.setItem(TICKETS_GROUP_BY_KEY, value);
    } catch {
      return;
    }
  }
  return [groupBy, change];
}
