import { Copy, Pencil, Trash2 } from "lucide-react";
import type { Playbook } from "../../../../shared/types.js";
import { Button } from "@/components/ui/button";
import { withoutBubbling } from "@/components/without-bubbling";
import { Item, ItemActions, ItemContent } from "@/components/ui/item";

interface PlaybookRowProps {
  playbook: Playbook;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

export function PlaybookRow({
  playbook,
  onEdit,
  onDuplicate,
  onDelete,
}: PlaybookRowProps) {
  return (
    <Item
      size="sm"
      className="flex-nowrap gap-2 p-2 hover:bg-accent"
      onClick={onEdit}
    >
      <ItemContent className="min-w-0 cursor-pointer">
        <span className="truncate font-mono text-sm font-semibold text-foreground">
          {playbook.name}
        </span>
      </ItemContent>
      <ItemActions className="gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={`Duplicate ${playbook.name}`}
          onClick={withoutBubbling(onDuplicate)}
        >
          <Copy aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={`Edit ${playbook.name}`}
          onClick={withoutBubbling(onEdit)}
        >
          <Pencil aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={`Delete ${playbook.name}`}
          onClick={withoutBubbling(onDelete)}
        >
          <Trash2 aria-hidden="true" />
        </Button>
      </ItemActions>
    </Item>
  );
}
