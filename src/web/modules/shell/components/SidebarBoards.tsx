import { ChevronDownIcon, PlusIcon } from "lucide-react";
import { formatCount } from "../../../../shared/format-count.js";
import type { BoardKey } from "../../../../shared/types.js";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import {
  attentionLabel,
  loopsLabel,
  type SwitcherItem,
} from "@/modules/shell/domain/board-switcher";

const ROW_CLASS =
  "font-medium text-base text-muted-foreground hover:text-muted-foreground data-[active=true]:hover:text-(--accent-text)";

export interface SidebarBoardsData {
  items: readonly SwitcherItem[] | null;
  failed: boolean;
  staleLabel: string | null;
  onOpenBoard: (key: BoardKey) => void;
  onCreate: () => void;
  onRetry: () => void;
}

export function SidebarBoards({
  items,
  failed,
  staleLabel,
  onOpenBoard,
  onCreate,
  onRetry,
}: SidebarBoardsData) {
  return (
    <Collapsible defaultOpen asChild>
      <SidebarGroup className="p-0">
        <CollapsibleTrigger asChild>
          <SidebarGroupLabel asChild>
            <button
              type="button"
              className="h-auto w-full justify-between rounded-none pt-2 pb-1 font-semibold tracking-[0.04em] text-muted-foreground uppercase [&[data-state=closed]>svg]:-rotate-90"
            >
              Boards
              <ChevronDownIcon aria-hidden="true" />
            </button>
          </SidebarGroupLabel>
        </CollapsibleTrigger>
        <CollapsibleContent>
          {items === null ? (
            failed ? (
              <div className="flex flex-col items-start gap-1 px-2 pb-1">
                <p className="m-0 text-xs text-muted-foreground">
                  Boards did not load.
                </p>
                <Button variant="outline" size="xs" onClick={onRetry}>
                  Try again
                </Button>
              </div>
            ) : (
              <div className="flex flex-col gap-1" aria-hidden="true">
                <Skeleton className="h-8" />
                <Skeleton className="h-8" />
              </div>
            )
          ) : (
            <SidebarMenu className="gap-0">
              {items.map((item) => (
                <SidebarMenuItem key={item.key}>
                  <SidebarMenuButton
                    type="button"
                    isActive={item.selected}
                    aria-current={item.selected ? "true" : undefined}
                    className={ROW_CLASS}
                    onClick={() => onOpenBoard(item.key)}
                  >
                    <span className="min-w-0 flex-1 truncate" title={item.name}>
                      {item.name}
                    </span>
                    {item.attention > 0 ? (
                      <Badge
                        tone="accent"
                        aria-label={attentionLabel(item.attention)}
                      >
                        {formatCount(item.attention)}
                      </Badge>
                    ) : null}
                    {item.loops > 0 ? (
                      <span
                        aria-label={loopsLabel(item.loops)}
                        className="shrink-0 text-xs text-muted-foreground"
                      >
                        {formatCount(item.loops)}
                      </span>
                    ) : null}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
              <SidebarMenuItem>
                <SidebarMenuButton
                  type="button"
                  className={ROW_CLASS}
                  onClick={onCreate}
                >
                  <PlusIcon aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">Create board</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          )}
          {staleLabel === null ? null : (
            <p className="m-0 px-2 py-1 text-xs text-muted-foreground">
              {staleLabel}
            </p>
          )}
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  );
}
