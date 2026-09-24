import {
  Activity,
  Archive,
  ClipboardList,
  Inbox,
  Kanban,
  KeyRound,
  PanelLeft,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { Page } from "../../lib/route.js";

export type NavGroup = "Home" | "Work" | "System";

export interface NavItem {
  page: Page;
  label: string;
  icon: LucideIcon;
  group: NavGroup;
}

export const NAV_GROUPS: readonly NavGroup[] = ["Home", "Work", "System"];

export const NAV_ITEMS: readonly NavItem[] = [
  { page: "inbox", label: "Inbox", icon: Inbox, group: "Home" },
  { page: "board", label: "Board", icon: Kanban, group: "Work" },
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
