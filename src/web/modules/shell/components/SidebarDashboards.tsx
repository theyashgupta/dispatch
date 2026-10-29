import { ChevronDownIcon } from "lucide-react";
import type { BoardKey } from "../../../../shared/types.js";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
} from "@/components/ui/sidebar";
import type { SwitcherItem } from "@/modules/shell/domain/board-switcher";
import { SidebarBoardRow } from "./SidebarBoardRow";

export interface SidebarDashboardsData {
  items: readonly SwitcherItem[] | null;
  onOpenDashboard: (key: BoardKey) => void;
}

export function SidebarDashboards({
  items,
  onOpenDashboard,
}: SidebarDashboardsData) {
  if (items === null || items.length === 0) return null;
  return (
    <Collapsible defaultOpen asChild>
      <SidebarGroup className="p-0">
        <CollapsibleTrigger asChild>
          <SidebarGroupLabel asChild>
            <button
              type="button"
              className="h-auto w-full justify-between rounded-none pt-2 pb-1 font-semibold tracking-[0.04em] text-muted-foreground uppercase [&[data-state=closed]>svg]:-rotate-90"
            >
              Dashboards
              <ChevronDownIcon aria-hidden="true" />
            </button>
          </SidebarGroupLabel>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenu className="gap-0">
            {items.map((item) => (
              <SidebarBoardRow
                key={item.key}
                item={item}
                showLoops={false}
                onOpen={onOpenDashboard}
              />
            ))}
          </SidebarMenu>
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  );
}
