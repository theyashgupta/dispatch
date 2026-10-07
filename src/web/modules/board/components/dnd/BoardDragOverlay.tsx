import { DragOverlay } from "@dnd-kit/core";
import type { Card } from "../../../../../shared/types.js";
import {
  deriveShowDot,
  deriveShowGone,
} from "../../../../../shared/card-badges.js";
import { useLastOpened } from "@/components/ui/hooks/use-last-opened";
import { CardView } from "../CardView";

interface BoardDragOverlayProps {
  card: Card | null;
  members?: Card[];
  selected: boolean;
  ids: string[] | null;
}

export function BoardDragOverlay({
  card,
  members,
  selected,
  ids,
}: BoardDragOverlayProps) {
  const lastOpenedMap = useLastOpened();
  const view =
    card != null ? (
      <CardView
        card={card}
        members={members}
        selected={selected}
        showDot={deriveShowDot(card, selected, lastOpenedMap)}
        showGone={deriveShowGone(card)}
        hover={false}
        elevated
        domProps={{ "aria-hidden": true, inert: true }}
      />
    ) : null;

  return (
    <DragOverlay dropAnimation={null} className="pointer-events-none">
      {card != null && ids == null ? view : null}
      {card != null && ids != null ? (
        <div className="relative isolate" aria-hidden inert>
          {ids.length >= 3 && (
            <div className="absolute inset-0 z-1 translate-[8px] rounded-md border border-border bg-card" />
          )}
          <div className="absolute inset-0 z-2 translate-[4px] rounded-md border border-border bg-card" />
          <div className="relative z-3">{view}</div>
          <span className="absolute -top-(--space-sm) -right-(--space-sm) z-4 inline-flex h-[20px] min-w-[20px] items-center justify-center rounded-(--radius-pill) bg-(--accent) px-(--space-xs) text-sm font-semibold text-(--on-accent)">
            {ids.length}
          </span>
        </div>
      ) : null}
    </DragOverlay>
  );
}
