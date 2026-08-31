import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { useDraggable } from "@dnd-kit/core";
import type {
  Card as CardModel,
  Column as ColumnId,
} from "../../../shared/types.js";
import { CardView } from "./CardView.js";
import { playCardMoveFlip, recordCardMoveRect } from "./card-move-flip.js";
import { useLastOpened } from "../../hooks/useUnseenActivity.js";
import { deriveShowDot, deriveShowGone } from "../../lib/card-badges.js";

interface CardProps {
  card: CardModel;
  selected?: boolean;
  multiSelected?: boolean;
  forceDimmed?: boolean;
  members?: CardModel[];
  onSelect?: (id: string) => void;
  onStartRequest?: (id: string) => void;
  onToggleSelect?: (id: string) => void;
  isCarousel?: boolean;
  onMoveTo?: (cardId: string, targetColumn: ColumnId) => void;
}

export function Card({
  card,
  selected = false,
  multiSelected = false,
  forceDimmed = false,
  members,
  onSelect,
  onStartRequest,
  onToggleSelect,
  isCarousel,
  onMoveTo,
}: CardProps) {
  const [hover, setHover] = useState(false);
  const [pressed, setPressed] = useState(false);
  const [focused, setFocused] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const showGone = deriveShowGone(card);

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: card.id,
  });

  const nodeRef = useRef<HTMLDivElement | null>(null);
  const setRootRef = useCallback(
    (node: HTMLDivElement | null) => {
      setNodeRef(node);
      nodeRef.current = node;
    },
    [setNodeRef],
  );

  useLayoutEffect(() => {
    const node = nodeRef.current;
    if (node != null && !isDragging) {
      playCardMoveFlip(card.id, node);
    }
    return () => {
      const outgoing = nodeRef.current;
      if (outgoing != null) recordCardMoveRect(card.id, outgoing);
    };
  }, [card.id, isDragging]);

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
      pressed={pressed}
      focused={focused}
      dimmed={isDragging || forceDimmed}
      rootRef={setRootRef}
      onSelect={onSelect}
      onStartRequest={onStartRequest}
      expanded={expanded}
      onToggleExpand={() => setExpanded((v) => !v)}
      members={members}
      isCarousel={isCarousel}
      onMoveTo={onMoveTo}
      domProps={{
        ...listeners,
        ...attributes,
        onMouseEnter: () => setHover(true),
        onMouseLeave: () => setHover(false),
        onPointerDown: (event) => {
          listeners?.onPointerDown?.(event);
          setPressed(true);
        },
        onPointerUp: (event) => {
          listeners?.onPointerUp?.(event);
          setPressed(false);
        },
        onPointerCancel: (event) => {
          listeners?.onPointerCancel?.(event);
          setPressed(false);
        },
        onPointerLeave: (event) => {
          listeners?.onPointerLeave?.(event);
          setPressed(false);
        },
        onFocus: (event) => {
          listeners?.onFocus?.(event);
          setFocused(event.currentTarget.matches(":focus-visible"));
        },
        onBlur: (event) => {
          listeners?.onBlur?.(event);
          setFocused(false);
        },
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
