import {
  Activity,
  AlertTriangle,
  Archive,
  GitPullRequest,
  CalendarDays,
  ClipboardList,
  HardDrive,
  Inbox,
  Kanban,
  KeyRound,
  MessageSquare,
  Mic,
  MessageCircleQuestion,
  PanelLeft,
  SquareTerminal,
  Sun,
  Ticket,
  Users,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import type { ItemSourceId } from "../../../shared/types.js";
import type { Page } from "../../../shared/route.js";

export type NavGroup = "Home" | "Work" | "Sources" | "System";

export interface NavItem {
  page: Page;
  label: string;
  icon: LucideIcon;
  group: NavGroup;
  source?: ItemSourceId;
}

export const NAV_GROUPS: readonly NavGroup[] = [
  "Home",
  "Work",
  "Sources",
  "System",
];

export const NAV_ITEMS: readonly NavItem[] = [
  { page: "today", label: "Today", icon: Sun, group: "Home" },
  { page: "inbox", label: "Inbox", icon: Inbox, group: "Home" },
  { page: "ask", label: "Ask", icon: MessageCircleQuestion, group: "Home" },
  { page: "board", label: "Board", icon: Kanban, group: "Work" },
  { page: "sessions", label: "Sessions", icon: SquareTerminal, group: "Work" },
  { page: "workspace", label: "Workspace", icon: PanelLeft, group: "Work" },
  { page: "activity", label: "Activity", icon: Activity, group: "Work" },
  { page: "tickets", label: "Tickets", icon: Ticket, group: "Sources" },
  {
    page: "accounts",
    label: "Accounts and Usage",
    icon: Users,
    group: "System",
  },
  {
    page: "playbooks",
    label: "Playbooks",
    icon: ClipboardList,
    group: "System",
  },
  { page: "vault", label: "Vault", icon: KeyRound, group: "System" },
  { page: "archive", label: "Archive", icon: Archive, group: "System" },
  {
    page: "pull-requests",
    label: "Pull Requests",
    icon: GitPullRequest,
    group: "Sources",
  },
  { page: "errors", label: "Errors", icon: AlertTriangle, group: "Sources" },
  { page: "meetings", label: "Meetings", icon: Mic, group: "Sources" },
  {
    page: "calendar",
    label: "Calendar",
    icon: CalendarDays,
    group: "Sources",
  },
  {
    page: "slack",
    label: "Slack",
    icon: MessageSquare,
    group: "Sources",
    source: "slack",
  },
  {
    page: "workspaces",
    label: "Workspaces",
    icon: HardDrive,
    group: "System",
  },
  { page: "flow", label: "Flow", icon: Workflow, group: "System" },
];

/**
 * Groups the nav rows in display order, dropping every group that has no row.
 * @remarks A group with no rows is dropped rather than rendered as an empty label.
 */
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
