import {
  Activity,
  AlertTriangle,
  Archive,
  GitPullRequest,
  ClipboardList,
  Inbox,
  Kanban,
  KeyRound,
  PanelLeft,
  SquareTerminal,
  Sun,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { Page } from "../../lib/route.js";

export type NavGroup = "Home" | "Work" | "Sources" | "System";

export interface NavItem {
  page: Page;
  label: string;
  icon: LucideIcon;
  group: NavGroup;
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
  { page: "board", label: "Board", icon: Kanban, group: "Work" },
  { page: "sessions", label: "Sessions", icon: SquareTerminal, group: "Work" },
  { page: "workspace", label: "Workspace", icon: PanelLeft, group: "Work" },
  { page: "activity", label: "Activity", icon: Activity, group: "Work" },
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
