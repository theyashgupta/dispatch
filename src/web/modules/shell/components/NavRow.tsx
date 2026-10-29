import type { Page } from "../../../../shared/route.js";
import { Badge } from "@/components/ui/badge";
import { SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { NavIcon } from "@/modules/shell/components/NavIcon";
import { navRailDot, navRailLabel } from "@/modules/shell/domain/rail-label";

const ROW_CLASS =
  "font-medium text-base text-muted-foreground hover:text-muted-foreground group-data-[collapsible=icon]:w-full! group-data-[collapsible=icon]:justify-center data-[active=true]:bg-[color-mix(in_srgb,var(--accent)_16%,var(--surface-column))] data-[active=true]:hover:text-(--accent-text) data-[active=true]:hover:bg-[color-mix(in_srgb,var(--accent)_16%,var(--surface-column))]";

const DOT_TONE = {
  accent: "bg-(--accent)",
  live: "bg-(--col-in-progress)",
  muted: "bg-muted-foreground",
} as const;

interface NavRowProps {
  page: Page;
  label: string;
  brand?: string;
  active: boolean;
  collapsed: boolean;
  count?: number;
  neutral?: boolean;
  spokenLabel?: string;
  dot?: "accent" | "live" | "muted" | null;
  onNavigate: (page: Page) => void;
}

export function NavRow({
  page,
  label,
  brand,
  active,
  collapsed,
  count = 0,
  neutral = false,
  spokenLabel,
  dot,
  onNavigate,
}: NavRowProps) {
  const tone = dot === undefined ? navRailDot(count, neutral) : dot;
  const icon = <NavIcon page={page} brand={brand} />;
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        type="button"
        isActive={active}
        aria-current={active ? "page" : undefined}
        aria-label={
          collapsed ? (spokenLabel ?? navRailLabel(label, count)) : undefined
        }
        tooltip={collapsed ? label : undefined}
        className={ROW_CLASS}
        onClick={() => onNavigate(page)}
      >
        {collapsed && tone !== null ? (
          <span className="relative inline-flex">
            {icon}
            <span
              aria-hidden="true"
              className={`absolute -top-0.5 -right-0.5 size-1.5 rounded-full ${DOT_TONE[tone]}`}
            />
          </span>
        ) : (
          icon
        )}
        {collapsed ? null : (
          <span className="min-w-0 flex-1 truncate" title={label}>
            {label}
          </span>
        )}
        {collapsed || count <= 0 ? null : (
          <Badge tone={neutral ? "neutral" : "accent"}>{count}</Badge>
        )}
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
