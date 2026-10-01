import type { Page } from "../../../../shared/route.js";
import { Badge } from "@/components/ui/badge";
import { SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { Spinner } from "@/components/ui/spinner";
import { NavIcon } from "@/modules/shell/components/NavIcon";

const ROW_CLASS =
  "font-medium text-base text-muted-foreground hover:text-muted-foreground group-data-[collapsible=icon]:w-full! group-data-[collapsible=icon]:justify-center data-[active=true]:bg-[color-mix(in_srgb,var(--accent)_16%,var(--surface-column))] data-[active=true]:hover:text-(--accent-text) data-[active=true]:hover:bg-[color-mix(in_srgb,var(--accent)_16%,var(--surface-column))]";

interface NavRowProps {
  page: Page;
  label: string;
  brand?: string;
  active: boolean;
  collapsed: boolean;
  live?: boolean;
  count?: number;
  neutral?: boolean;
  onNavigate: (page: Page) => void;
}

export function NavRow({
  page,
  label,
  brand,
  active,
  collapsed,
  live = false,
  count = 0,
  neutral = false,
  onNavigate,
}: NavRowProps) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        type="button"
        isActive={active}
        aria-current={active ? "page" : undefined}
        aria-label={collapsed ? label : undefined}
        tooltip={collapsed ? label : undefined}
        className={ROW_CLASS}
        onClick={() => onNavigate(page)}
      >
        {live ? (
          <Spinner aria-hidden="true" />
        ) : (
          <NavIcon page={page} brand={brand} />
        )}
        {collapsed ? null : (
          <span className="min-w-0 flex-1 truncate">{label}</span>
        )}
        {collapsed || count <= 0 ? null : (
          <Badge tone={neutral ? "neutral" : "accent"}>{count}</Badge>
        )}
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
