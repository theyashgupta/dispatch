import type { ItemSourceId } from "./types.js";
import type { Page } from "./route.js";

export type NavGroup = "Home" | "Work" | "Sources" | "System";

export interface NavItem {
  page: Page;
  label: string;
  group: NavGroup;
  source?: ItemSourceId;
  brand?: string;
}

export type NavCounts = Partial<Record<Page, number>>;

export const NAV_GROUPS: readonly NavGroup[] = [
  "Home",
  "Work",
  "Sources",
  "System",
];

export const NAV_ITEMS: readonly NavItem[] = [
  { page: "today", label: "Today", group: "Home" },
  { page: "inbox", label: "Inbox", group: "Home" },
  { page: "ask", label: "Ask", group: "Home" },
  { page: "board", label: "Board", group: "Work" },
  { page: "sessions", label: "Sessions", group: "Work" },
  { page: "workspace", label: "Workspace", group: "Work" },
  { page: "activity", label: "Activity", group: "Work" },
  {
    page: "tickets",
    label: "Tickets",
    group: "Sources",
    brand: "linear",
  },
  {
    page: "accounts",
    label: "Accounts and Usage",
    group: "System",
  },
  {
    page: "playbooks",
    label: "Playbooks",
    group: "System",
  },
  { page: "vault", label: "Vault", group: "System" },
  { page: "archive", label: "Archive", group: "System" },
  {
    page: "pull-requests",
    label: "Pull Requests",
    group: "Sources",
    brand: "github",
  },
  {
    page: "errors",
    label: "Errors",
    group: "Sources",
    brand: "sentry",
  },
  {
    page: "meetings",
    label: "Meetings",
    group: "Sources",
    brand: "meeting",
  },
  {
    page: "calendar",
    label: "Calendar",
    group: "Sources",
    brand: "calendar",
  },
  {
    page: "slack",
    label: "Slack",
    group: "Sources",
    source: "slack",
    brand: "slack",
  },
  {
    page: "workspaces",
    label: "Workspaces",
    group: "System",
  },
  { page: "flow", label: "Flow", group: "System" },
];

/** Groups the nav rows in display order, dropping every group that has no row. */
export function navGroups(
  items: readonly NavItem[],
): { group: NavGroup; items: NavItem[] }[] {
  return NAV_GROUPS.map((group) => ({
    group,
    items: items.filter((item) => item.group === group),
  })).filter((entry) => entry.items.length > 0);
}

/**
 * Return the nav rows to show: a row tied to a source appears only while that source is enabled.
 *
 * @remarks Rows without a source always show. The palette's "Go to" commands take this same list.
 */
export function visibleNavItems(
  items: readonly NavItem[],
  enabledSources: readonly string[],
): NavItem[] {
  return items.filter(
    (item) => item.source === undefined || enabledSources.includes(item.source),
  );
}
