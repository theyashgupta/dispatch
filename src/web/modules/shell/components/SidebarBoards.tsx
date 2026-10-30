import { ChevronDownIcon, PlusIcon } from "lucide-react";
import type { BoardKey } from "../../../../shared/types.js";
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
import type { SwitcherItem } from "@/modules/shell/domain/board-switcher";
import { BOARD_ROW_CLASS, SidebarBoardRow } from "./SidebarBoardRow";

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
              className="h-auto w-full justify-between rounded-none pt-2 pb-1 font-semibold tracking-(--tracking-label) text-muted-foreground uppercase [&[data-state=closed]>svg]:-rotate-90"
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
                <SidebarBoardRow
                  key={item.key}
                  item={item}
                  showLoops
                  onOpen={onOpenBoard}
                />
              ))}
              <SidebarMenuItem>
                <SidebarMenuButton
                  type="button"
                  className={BOARD_ROW_CLASS}
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
