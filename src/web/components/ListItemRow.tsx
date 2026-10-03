import type { KeyboardEvent, ReactNode } from "react";
import { Item, ItemActions, ItemContent } from "@/components/ui/item";
import { cn } from "@/lib/utils";

interface ListItemRowProps {
  id: string;
  leading: ReactNode;
  title: ReactNode;
  snippet?: string;
  meta: ReactNode;
  metaClassName?: string;
  selected: boolean;
  unread: boolean;
  onSelect: () => void;
}

export function ListItemRow({
  id,
  leading,
  title,
  snippet,
  meta,
  metaClassName,
  selected,
  unread,
  onSelect,
}: ListItemRowProps) {
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    if (event.repeat) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onSelect();
  }

  return (
    <Item
      id={id}
      role="listitem"
      tabIndex={0}
      size="sm"
      aria-current={selected ? "true" : undefined}
      className="cursor-pointer flex-nowrap gap-2 rounded-none border-b-border px-4 py-2 hover:bg-accent focus-visible:-outline-offset-2 aria-[current=true]:border-primary aria-[current=true]:bg-card"
      onClick={onSelect}
      onKeyDown={handleKeyDown}
    >
      <div className="flex shrink-0 items-center gap-1">{leading}</div>
      <ItemContent className="min-w-0 gap-0.5">
        <span
          className={cn(
            "truncate text-base text-foreground",
            unread && "font-semibold",
          )}
        >
          {title}
        </span>
        {snippet ? (
          <span className="line-clamp-2 text-sm break-words text-muted-foreground">
            {snippet}
          </span>
        ) : null}
      </ItemContent>
      {unread ? (
        <span
          aria-hidden="true"
          className="size-1.5 shrink-0 rounded-full bg-primary"
        />
      ) : null}
      <ItemActions className={cn("shrink-0 gap-2", metaClassName)}>
        {meta}
      </ItemActions>
    </Item>
  );
}
