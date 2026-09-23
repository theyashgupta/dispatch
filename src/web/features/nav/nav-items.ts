import {
  Activity,
  Inbox,
  Kanban,
  PanelLeft,
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
];

/**
 * Groups the nav rows in display order, dropping every group that has no row.
 * @remarks System stays hidden until a page exists for it, so the sidebar never shows an empty
 * label.
 */
export function navGroups(
  items: readonly NavItem[],
): { group: NavGroup; items: NavItem[] }[] {
  return NAV_GROUPS.map((group) => ({
    group,
    items: items.filter((item) => item.group === group),
  })).filter((entry) => entry.items.length > 0);
}
