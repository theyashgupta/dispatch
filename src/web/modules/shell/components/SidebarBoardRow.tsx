import { formatCount } from "../../../../shared/format-count.js";
import type { BoardKey } from "../../../../shared/types.js";
import { Badge } from "@/components/ui/badge";
import { SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import {
  attentionLabel,
  loopsLabel,
  type SwitcherItem,
} from "@/modules/shell/domain/board-switcher";

export const BOARD_ROW_CLASS =
  "font-medium text-base text-muted-foreground hover:text-muted-foreground data-[active=true]:hover:text-(--accent-text)";

export function SidebarBoardRow({
  item,
  showLoops,
  onOpen,
}: {
  item: SwitcherItem;
  showLoops: boolean;
  onOpen: (key: BoardKey) => void;
}) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        type="button"
        isActive={item.selected}
        aria-current={item.selected ? "true" : undefined}
        className={BOARD_ROW_CLASS}
        onClick={() => onOpen(item.key)}
      >
        <span className="min-w-0 flex-1 truncate" title={item.name}>
          {item.name}
        </span>
        {item.attention > 0 ? (
          <Badge tone="accent" aria-label={attentionLabel(item.attention)}>
            {formatCount(item.attention)}
          </Badge>
        ) : null}
        {showLoops && item.loops > 0 ? (
          <span
            aria-label={loopsLabel(item.loops)}
            className="shrink-0 text-xs text-muted-foreground"
          >
            {formatCount(item.loops)}
          </span>
        ) : null}
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
