import { AlertTriangle, Users } from "lucide-react";
import type { Card as CardModel } from "../../../../shared/types.js";
import { deriveShowDot } from "../../../../shared/card-badges.js";
import {
  attentionTitle,
  needsAttention,
} from "../../../../shared/card-attention.js";
import { COLUMN_ACCENT } from "../../../../shared/column-accent.js";
import { SourceBadge } from "@/components/badges/SourceBadge";
import { Badge } from "@/components/ui/badge";
import { useLastOpened } from "@/components/ui/hooks/use-last-opened";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { cn } from "@/lib/utils";

interface OrcaNavRowProps {
  card: CardModel;
  selected: boolean;
  onSelect: (id: string) => void;
}

export function OrcaNavRow({ card, selected, onSelect }: OrcaNavRowProps) {
  const lastOpenedMap = useLastOpened();
  const unseen = deriveShowDot(card, selected, lastOpenedMap);
  const attention = needsAttention(card);
  const memberCount = card.memberIds?.length ?? 0;

  function select() {
    onSelect(card.id);
  }

  return (
    <Item
      role="button"
      tabIndex={0}
      size="sm"
      aria-current={selected ? "true" : undefined}
      className={cn(
        "cursor-pointer flex-nowrap gap-2 rounded-none border-0 border-l-2 px-2 py-1 hover:bg-accent",
        selected ? "border-l-primary" : "border-l-transparent",
      )}
      onClick={select}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          select();
        } else if (event.key === " ") {
          event.preventDefault();
          select();
        }
      }}
    >
      <ItemMedia className="font-mono text-xs leading-(--line-label) font-semibold text-muted-foreground">
        {card.identifier}
      </ItemMedia>
      <ItemContent className="min-w-0 gap-0">
        <ItemTitle
          title={card.title}
          className="block w-full truncate text-base leading-(--line-body) font-normal text-foreground"
        >
          {card.title}
        </ItemTitle>
      </ItemContent>
      <ItemActions className="shrink-0">
        {attention ? (
          <span title={attentionTitle(card) ?? undefined} className="flex">
            <AlertTriangle
              size={12}
              strokeWidth={2}
              aria-hidden="true"
              className="text-destructive"
            />
          </span>
        ) : (
          <Badge
            stateColor={COLUMN_ACCENT[card.column]}
            className="size-1.5 rounded-full border-0 bg-(--badge-state) p-0"
          />
        )}
        {card.source === "group" ? (
          <Badge tone="neutral">
            <Users size={12} strokeWidth={2} aria-hidden="true" />
            {memberCount === 1 ? "1 ticket" : `${memberCount} tickets`}
          </Badge>
        ) : (
          <SourceBadge source={card.source ?? "linear"} />
        )}
        {unseen && (
          <Badge
            aria-hidden="true"
            className="size-1.5 rounded-full border-0 bg-(--status-ok) p-0"
          />
        )}
      </ItemActions>
    </Item>
  );
}
