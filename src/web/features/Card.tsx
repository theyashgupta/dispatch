import { useState } from "react";
import { useDraggable } from "@dnd-kit/core";
import type { Card as CardModel } from "../../shared/types.js";
import { CardView } from "./CardView.js";
import { useLastOpened } from "../hooks/useUnseenActivity.js";
import { deriveShowDot, deriveShowGone } from "../lib/cardBadges.js";

interface CardProps {
  card: CardModel;
  selected?: boolean;
  onSelect?: (id: string) => void;
}

export function Card({ card, selected = false, onSelect }: CardProps) {
  const [hover, setHover] = useState(false);
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
      showDot={showDot}
      showGone={showGone}
      hover={hover}
      dimmed={isDragging}
      rootRef={setNodeRef}
      onSelect={onSelect}
      domProps={{
        ...listeners,
        ...attributes,
        onMouseEnter: () => setHover(true),
        onMouseLeave: () => setHover(false),
        onClick: () => {
          if (isDragging) return;
          onSelect?.(card.id);
        },
      }}
    />
  );
}
