import { calendarPermissionCopy } from "../../../../shared/connection-status.js";
import { formatAge } from "../../../../shared/format-age.js";
import type {
  CalendarPermission,
  CalendarStatus,
} from "../../../../shared/types.js";

export type CalendarAccessTone = "success" | "neutral" | "warning";

export interface CalendarAccessDetails {
  lastPoll: string;
  eventCount: string;
}

export interface CalendarAccessView {
  label: string;
  tone: CalendarAccessTone;
  message: string | null;
  appName: string;
  showCheckAccess: boolean;
  showSystemSettings: boolean;
  details: CalendarAccessDetails | null;
  missing: string[];
}

const PERMISSION_VIEW: Record<
  CalendarPermission,
  {
    label: string;
    tone: CalendarAccessTone;
    showCheckAccess: boolean;
    showSystemSettings: boolean;
  }
> = {
  granted: {
    label: "Allowed",
    tone: "success",
    showCheckAccess: false,
    showSystemSettings: false,
  },
  "not-asked": {
    label: "Not asked",
    tone: "neutral",
    showCheckAccess: true,
    showSystemSettings: true,
  },
  denied: {
    label: "Denied",
    tone: "warning",
    showCheckAccess: true,
    showSystemSettings: true,
  },
  restricted: {
    label: "Restricted",
    tone: "warning",
    showCheckAccess: false,
    showSystemSettings: false,
  },
  "write-only": {
    label: "Write only",
    tone: "warning",
    showCheckAccess: false,
    showSystemSettings: true,
  },
  "prompt-timeout": {
    label: "No answer",
    tone: "warning",
    showCheckAccess: true,
    showSystemSettings: false,
  },
  "read-timeout": {
    label: "Read timed out",
    tone: "warning",
    showCheckAccess: false,
    showSystemSettings: false,
  },
  unknown: {
    label: "Unknown",
    tone: "neutral",
    showCheckAccess: true,
    showSystemSettings: false,
  },
};

/**
 * What the Calendar access block shows for a status.
 *
 * @remarks
 * Check access also shows for `denied` because it re-reads the permission after a change in System
 * Settings. The details appear only while the connection is on.
 */
export function calendarAccessView(
  status: CalendarStatus,
  now: Date,
): CalendarAccessView {
  const view = PERMISSION_VIEW[status.permission];
  let details: CalendarAccessDetails | null = null;
  if (status.enabled) {
    const count = status.eventCount ?? 0;
    details = {
      lastPoll:
        status.lastPolledAt === undefined
          ? "Not read yet"
          : `Last read ${formatAge(status.lastPolledAt, now.getTime())}`,
      eventCount: `${count} ${count === 1 ? "event" : "events"} in the next 48 hours`,
    };
  }
  return {
    label: view.label,
    tone: view.tone,
    message: calendarPermissionCopy(status.permission),
    appName: "Dispatch Calendar",
    showCheckAccess: view.showCheckAccess,
    showSystemSettings: view.showSystemSettings,
    details,
    missing: status.missingCalendars,
  };
}
