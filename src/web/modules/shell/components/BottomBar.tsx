import { useState } from "react";
import { Plus } from "lucide-react";
import type { Page } from "../../../../shared/route.js";
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
}

export function BottomBar({
  current,
  onNavigate,
  onOpenCreateTicket,
}: BottomBarProps) {
  const [el, setEl] = useState<HTMLElement | null>(null);
  useBottomBarHeight(el);
  const activeId = currentSlotId(current);
  return (
    <nav
      ref={setEl}
      aria-label="Bottom navigation"
      className="grid h-16 shrink-0 grid-cols-5 border-t border-border bg-(--surface-column) select-none"
    >
      {BOTTOM_BAR_SLOTS.map((slot) => {
        const { page } = slot;
        const active = slot.id === activeId;
        return (
          <Button
            key={slot.id}
            type="button"
            variant="ghost"
            aria-current={active ? "page" : undefined}
            className={cn(
              "h-full flex-col gap-1 rounded-none px-1 text-xs font-medium text-muted-foreground",
              active && "text-(--accent-text)",
            )}
            onClick={() =>
              page === null ? onOpenCreateTicket() : onNavigate(page)
            }
          >
            {page === null ? (
              <Plus size={16} strokeWidth={2} aria-hidden="true" />
            ) : (
              <NavIcon page={page} />
            )}
            <span>{slot.label}</span>
          </Button>
        );
      })}
    </nav>
  );
}
