import type { ReactNode } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { GripVerticalIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Item } from "@/components/ui/item";
import { cn } from "@/lib/utils";

interface ChainDragRowProps {
  id: string;
  name: string;
  disabled: boolean;
  children: ReactNode;
}

export function ChainDragRow({
  id,
  name,
  disabled,
  children,
}: ChainDragRowProps) {
  const {
    setNodeRef: setDragRef,
    setActivatorNodeRef,
    listeners,
    attributes,
    transform,
    isDragging,
  } = useDraggable({ id, disabled });
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id });
  return (
    <Item
      ref={(node: HTMLDivElement | null) => {
        setDragRef(node);
        setDropRef(node);
      }}
      variant="outline"
      size="sm"
      className={cn(
        "relative gap-2 bg-card p-2 text-foreground",
        isDragging && "z-10",
        isOver && !isDragging && "border-ring",
        transform && "shadow-lg",
      )}
      style={
        transform
          ? {
              transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
            }
          : undefined
      }
      data-testid="chain-row"
      data-account-id={id}
    >
      <Button
        ref={setActivatorNodeRef}
        variant="ghost"
        size="icon-xs"
        className="cursor-grab touch-none"
        aria-label={`Drag ${name} to reorder`}
        data-testid="chain-drag-handle"
        {...listeners}
        {...attributes}
      >
        <GripVerticalIcon aria-hidden="true" />
      </Button>
      {children}
    </Item>
  );
}
