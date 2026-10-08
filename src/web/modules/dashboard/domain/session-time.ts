import { formatMinutes } from "../../../../shared/loop-view.js";
import { activeSessionView } from "../../../../shared/active-session.js";
import type { Card } from "../../../../shared/types.js";

/** Returns the age of the active session as "Session 2 h 10 min", or null with no active session. */
export function sessionTime(card: Card, now: Date): string | null {
  const active = activeSessionView(card);
  if (active?.createdAt === undefined) return null;
  const minutes = Math.floor(
    (now.getTime() - Date.parse(active.createdAt)) / 60000,
  );
  return `Session ${formatMinutes(Math.max(0, minutes))}`;
}
