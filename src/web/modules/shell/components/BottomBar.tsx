import { useState } from "react";
import { Plus } from "lucide-react";
import type { Page } from "../../../../shared/route.js";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { NavIcon } from "@/modules/shell/components/NavIcon";
import {
  BOTTOM_BAR_SLOTS,
  currentSlotId,
} from "@/modules/shell/domain/bottom-bar";
import { useBottomBarHeight } from "@/modules/shell/hooks/use-bottom-bar-height";

interface BottomBarProps {
  current: Page;
  onNavigate: (page: Page) => void;
  onOpenCreateTicket: () => void;
  hidden: boolean;
  needsCount: number;
}

export function BottomBar({
  current,
  onNavigate,
  onOpenCreateTicket,
  hidden,
  needsCount,
}: BottomBarProps) {
  const [el, setEl] = useState<HTMLElement | null>(null);
  useBottomBarHeight(el);
  const activeId = currentSlotId(current);
  return (
    <nav
      ref={setEl}
      aria-label="Bottom navigation"
      inert={hidden}
      className={cn(
        "grid shrink-0 grid-cols-5 overflow-hidden border-border bg-(--surface-column) transition-[height] duration-(--motion-panel-open) ease-(--easing-enter) select-none",
        hidden ? "h-0 border-t-0" : "h-16 border-t",
      )}
    >
      {BOTTOM_BAR_SLOTS.map((slot) => {
        const { page } = slot;
        const active = slot.id === activeId;
        const badged = page === "orchestrator" && needsCount > 0;
        return (
          <Button
            key={slot.id}
            type="button"
            variant="ghost"
            aria-current={active ? "page" : undefined}
            aria-label={
              badged ? `Orchestrator, ${needsCount} need you` : undefined
            }
            className={cn(
              "h-full flex-col gap-1 rounded-none px-1 text-xs font-medium text-muted-foreground",
              active && "text-(--accent-text)",
            )}
            onClick={() =>
              page === null ? onOpenCreateTicket() : onNavigate(page)
            }
          >
            <span className="relative">
              {page === null ? (
                <Plus size={16} strokeWidth={2} aria-hidden="true" />
              ) : (
                <NavIcon page={page} />
              )}
              {badged ? (
                <Badge tone="accent" className="absolute -top-2 left-3">
                  {needsCount}
                </Badge>
              ) : null}
            </span>
            <span>{slot.label}</span>
          </Button>
        );
      })}
    </nav>
  );
}
