import type { ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SidePanelExpandToggle } from "@/components/ui/side-panel";
import { CENTRE_TERMINAL_CLOSE_ID } from "@/modules/orchestrator/domain/centre-page-state";

interface CentrePaneProps {
  terminal: ReactNode;
  alertSlot: (element: HTMLElement | null) => void;
  expanded: boolean;
  onToggleExpand: () => void;
  onClose: () => void;
  sheet: boolean;
  terminalReady: boolean;
}

export function CentrePane({
  terminal,
  alertSlot,
  expanded,
  onToggleExpand,
  onClose,
  sheet,
  terminalReady,
}: CentrePaneProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-border px-(--space-lg) py-(--space-xs)">
        <span className="text-xs text-muted-foreground">Terminal</span>
        <div className="flex items-center gap-(--space-xs)">
          {!sheet && terminalReady && (
            <SidePanelExpandToggle
              expanded={expanded}
              onToggleExpand={onToggleExpand}
              expandLabel="Expand terminal"
              collapseLabel="Collapse terminal"
            />
          )}
          <Button
            variant="ghost"
            size="icon-md"
            id={CENTRE_TERMINAL_CLOSE_ID}
            onClick={onClose}
            aria-label="Close terminal"
          >
            <X className="size-4" aria-hidden="true" />
          </Button>
        </div>
      </div>
      <div ref={alertSlot} />
      <div className="flex min-h-0 flex-1 flex-col p-(--space-lg)">
        {terminal}
      </div>
    </div>
  );
}
