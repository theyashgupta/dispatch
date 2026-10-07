import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { useDraggable } from "@dnd-kit/core";
import type {
  Card as CardModel,
  Column as ColumnId,
} from "../../../../../shared/types.js";
import {
  deriveShowDot,
  deriveShowGone,
} from "../../../../../shared/card-badges.js";
import { useLastOpened } from "@/components/ui/hooks/use-last-opened";
import { CARD_DOM_PREFIX } from "@/modules/board/domain/board-keys";
import { isMultiSelectable } from "@/modules/board/domain/drag-selection";
import {
  playCardMoveFlip,
  recordCardMoveRect,
} from "@/modules/board/hooks/card-move-flip";
import {
  useResumeFeedback,
  type ResumeOutcome,
} from "@/components/ui/hooks/use-resume-feedback";
import { CardView } from "../CardView";

interface DraggableCardProps {
  card: CardModel;
  selected: boolean;
  multiSelected: boolean;
  forceDimmed: boolean;
  members?: CardModel[];
  isCarousel: boolean;
  onSelect: (id: string) => void;
  onToggleSelect: (id: string) => void;
  onMoveTo: (cardId: string, column: ColumnId) => void;
  onRetryStart: (card: CardModel) => void;
  onRestart: (card: CardModel) => void;
  resume: (id: string) => Promise<ResumeOutcome>;
}

export function DraggableCard({
  card,
  selected,
  multiSelected,
  forceDimmed,
  members,
  isCarousel,
  onSelect,
  onToggleSelect,
  onMoveTo,
  onRetryStart,
  onRestart,
  resume,
}: DraggableCardProps) {
  const [hover, setHover] = useState(false);
  const [pressed, setPressed] = useState(false);
  const [expanded, setExpanded] = useState(false);

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
    if (node != null) playCardMoveFlip(card.id, node);
    return () => {
      const outgoing = nodeRef.current;
      if (outgoing != null) recordCardMoveRect(card.id, outgoing);
    };
  }, [card.id]);

  const lastOpenedMap = useLastOpened();
  const showDot = deriveShowDot(card, selected, lastOpenedMap);
  const showGone = deriveShowGone(card);
  const resumeFeedback = useResumeFeedback(card, resume);

  return (
    <CardView
      card={card}
      selected={selected}
      multiSelected={multiSelected}
      showDot={showDot}
      showGone={showGone}
      hover={hover}
      pressed={pressed}
      dimmed={isDragging || forceDimmed}
      rootRef={setRootRef}
      onSelect={onSelect}
      expanded={expanded}
      onToggleExpand={() => setExpanded((v) => !v)}
      members={members}
      isCarousel={isCarousel}
      onMoveTo={onMoveTo}
      onRetryStart={onRetryStart}
      onRestart={onRestart}
      resuming={resumeFeedback.resuming}
      resumeFailed={resumeFeedback.resumeFailed}
      watchdogFired={resumeFeedback.watchdogFired}
      resumeFailureCopy={resumeFeedback.failureCopy}
      onResume={resumeFeedback.onResume}
      domProps={{
        ...listeners,
        ...attributes,
        id: `${CARD_DOM_PREFIX}${card.id}`,
        onKeyDown: (event) => {
          listeners?.onKeyDown?.(event);
          if (event.key === "Enter" && event.target === event.currentTarget) {
            onSelect(card.id);
          }
        },
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
        onClick: (event) => {
          if (isDragging) return;
          if (event.metaKey || event.ctrlKey) {
            if (isMultiSelectable(card)) onToggleSelect(card.id);
            return;
          }
          onSelect(card.id);
        },
      }}
    />
  );
}
