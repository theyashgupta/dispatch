import { useState } from "react";
import { Plus } from "lucide-react";
import type { Page } from "../../../../shared/route.js";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { NavIcon } from "@/modules/shell/components/NavIcon";
import { BOTTOM_BAR_SLOTS } from "@/modules/shell/domain/bottom-bar";
import { usePublishedHeight } from "@/modules/shell/hooks/use-published-height";

interface BottomBarProps {
  current: Page;
  onNavigate: (page: Page) => void;
  onOpenCreateTicket: () => void;
  hidden: boolean;
  needsYouCount: number;
}

export function BottomBar({
  current,
  onNavigate,
  onOpenCreateTicket,
  hidden,
  needsYouCount,
}: BottomBarProps) {
  const [el, setEl] = useState<HTMLElement | null>(null);
  usePublishedHeight(el, document.documentElement, "--bottom-bar-height");
  return (
    <nav
      ref={setEl}
      aria-label="Primary"
      inert={hidden}
      className={cn(
        "grid shrink-0 grid-cols-5 overflow-hidden border-border bg-(--surface-column) transition-[height] duration-(--motion-panel-open) ease-(--easing-enter) select-none",
        hidden ? "h-0 border-t-0" : "h-16 border-t",
      )}
    >
      {BOTTOM_BAR_SLOTS.map((slot) => {
        const { page } = slot;
        const active = slot.page === current;
        const badged = page === "orchestrator" && needsYouCount > 0;
        return (
          <Button
            key={slot.label}
            type="button"
            variant="ghost"
            aria-current={active ? "page" : undefined}
            aria-label={
              badged ? `Orchestrator, ${needsYouCount} need you` : undefined
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
                  {needsYouCount > 99 ? "99+" : needsYouCount}
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
