import { useEffect, useRef, useState } from "react";
import { ArrowRightLeft, Check } from "lucide-react";
import { COLUMNS } from "../../../../shared/types.js";
import type { Card, Column as ColumnId } from "../../../../shared/types.js";
import { COLUMN_LABELS } from "../../../../shared/column-labels.js";
import { blocksAgentDoneManualEntry } from "../../../../shared/column-transitions.js";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

interface MoveToPickerProps {
  card: Pick<Card, "identifier" | "column">;
  onSelect: (column: ColumnId) => void;
}

const PICKER_TARGETS = COLUMNS.filter(
  (column) => !blocksAgentDoneManualEntry(column),
);

export function MoveToPicker({ card, onSelect }: MoveToPickerProps) {
  const [open, setOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("resize", close);
    window.addEventListener("orientationchange", close);
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("orientationchange", close);
    };
  }, [open]);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto h-11 flex-none"
          onPointerDown={(e) => {
            e.stopPropagation();
            e.preventDefault();
          }}
          onClick={(e) => {
            e.stopPropagation();
            if (e.detail === 0) return;
            if (open) {
              setOpen(false);
              return;
            }
            setOpen(true);
            requestAnimationFrame(() =>
              contentRef.current
                ?.querySelector<HTMLElement>(
                  '[role="menuitem"]:not([data-disabled])',
                )
                ?.focus(),
            );
          }}
        >
          <ArrowRightLeft className="size-3" aria-hidden="true" />
          Move to…
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        aria-label={`Move ${card.identifier} to`}
        ref={contentRef}
        align="start"
        className="w-[clamp(200px,60vw,260px)] rounded-(--radius-lg) px-0 py-1 shadow-(--shadow-float)"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        {PICKER_TARGETS.map((column) => {
          const current = card.column === column;
          return (
            <DropdownMenuItem
              key={column}
              disabled={current}
              aria-current={current ? "true" : undefined}
              className={cn(
                "min-h-11 gap-(--space-sm) rounded-none px-(--space-lg) py-0 text-base",
                current &&
                  "font-semibold text-(--accent-text) data-[disabled]:opacity-100",
              )}
              onSelect={() => onSelect(column)}
            >
              <span className="flex-auto">{COLUMN_LABELS[column]}</span>
              {current && (
                <Check
                  className="size-3.5 flex-none text-(--accent)"
                  aria-hidden="true"
                />
              )}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
