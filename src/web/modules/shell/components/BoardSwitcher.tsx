import { CheckIcon, ChevronDownIcon } from "lucide-react";
import type { BoardKey } from "../../../../shared/types.js";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  attentionLabel,
  collapsedLabel,
  type SwitcherItem,
} from "@/modules/shell/domain/board-switcher";
import { cn } from "@/lib/utils";

export interface BoardSwitcherData {
  selected: BoardKey;
  items: readonly SwitcherItem[];
  failed: boolean;
  staleLabel: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (key: BoardKey) => void;
  onManage: () => void;
  onRetry: () => void;
}

export interface BoardSwitcherProps extends BoardSwitcherData {
  collapsed: boolean;
  mobile: boolean;
}

export function BoardSwitcher({
  selected,
  items,
  failed,
  staleLabel,
  open,
  onOpenChange,
  onSelect,
  onManage,
  onRetry,
  collapsed,
  mobile,
}: BoardSwitcherProps) {
  const name = failed
    ? selected
    : (items.find((item) => item.selected)?.name ?? selected);
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <Tooltip open={open ? false : undefined}>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              aria-label={`Switch board, current board ${name}`}
              className={cn(
                "h-7 w-full min-w-0 justify-between px-2",
                collapsed && "justify-center px-0 font-mono text-xs",
              )}
            >
              <span className="min-w-0 truncate">
                {collapsed ? collapsedLabel(selected) : name}
              </span>
              {collapsed ? null : <ChevronDownIcon aria-hidden="true" />}
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="right">
          Switch board (B) <Kbd>B</Kbd>
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        side={collapsed ? "right" : "bottom"}
        align="start"
        alignOffset={collapsed || mobile ? 0 : -8}
        className={
          mobile ? "w-(--radix-dropdown-menu-trigger-width)" : "w-(--nav-width)"
        }
      >
        {failed ? (
          <>
            <DropdownMenuItem disabled>Boards did not load.</DropdownMenuItem>
            <DropdownMenuItem onSelect={onRetry}>Try again</DropdownMenuItem>
          </>
        ) : (
          <>
            {items.map((item) => (
              <DropdownMenuItem
                key={item.key}
                aria-current={item.selected ? "true" : undefined}
                onSelect={() => onSelect(item.key)}
              >
                <span className="flex size-4 shrink-0 items-center justify-center">
                  {item.selected ? <CheckIcon aria-hidden="true" /> : null}
                </span>
                <span className="min-w-0 flex-1 truncate" title={item.name}>
                  {item.name}
                </span>
                <span className="font-mono text-xs text-muted-foreground">
                  {item.key}
                </span>
                {item.attention > 0 ? (
                  <Badge
                    tone="neutral"
                    aria-label={attentionLabel(item.attention)}
                  >
                    {item.attention}
                  </Badge>
                ) : null}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onManage}>
              Manage boards
            </DropdownMenuItem>
            {staleLabel === null ? null : (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                  {staleLabel}
                </DropdownMenuLabel>
              </>
            )}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
