import { useState } from "react";
import { useDraggable } from "@dnd-kit/core";
import type { Card as CardModel } from "../../../shared/types.js";
import { CardView } from "./CardView.js";
import { useLastOpened } from "../../hooks/useUnseenActivity.js";
import { deriveShowDot, deriveShowGone } from "../../lib/card-badges.js";

interface CardProps {
  card: CardModel;
  selected?: boolean;
  multiSelected?: boolean;
  members?: CardModel[];
  onSelect?: (id: string) => void;
  onStartRequest?: (id: string) => void;
  onToggleSelect?: (id: string) => void;
}

export function Card({
  card,
  selected = false,
  multiSelected = false,
  members,
  onSelect,
  onStartRequest,
  onToggleSelect,
}: CardProps) {
  const [hover, setHover] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const showGone = deriveShowGone(card);

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: card.id,
  });

  const lastOpenedMap = useLastOpened();
  const showDot = deriveShowDot(card, selected, lastOpenedMap);

  return (
    <CardView
      card={card}
      selected={selected}
      multiSelected={multiSelected}
      showDot={showDot}
      showGone={showGone}
      hover={hover}
      dimmed={isDragging}
      rootRef={setNodeRef}
      onSelect={onSelect}
      onStartRequest={onStartRequest}
      expanded={expanded}
      onToggleExpand={() => setExpanded((v) => !v)}
      members={members}
      domProps={{
        ...listeners,
        ...attributes,
        onMouseEnter: () => setHover(true),
        onMouseLeave: () => setHover(false),
        onClick: (event) => {
          if (isDragging) return;
          if (event.metaKey || event.ctrlKey) {
            if (
              card.column === "todo" &&
              card.groupId == null &&
              card.source !== "group"
            ) {
              onToggleSelect?.(card.id);
            }
            return;
          }
          onSelect?.(card.id);
        },
      }}
    />
  );
}
