import { X } from "lucide-react";
import { useRef, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { SHELL_IDS } from "@/modules/shell/domain/shell-ids";

interface ActivityDrawerProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}

export function ActivityDrawer({
  open,
  onClose,
  children,
}: ActivityDrawerProps) {
  const closedFromDrawer = useRef(false);
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (next) return;
        closedFromDrawer.current = true;
        onClose();
      }}
    >
      <SheetContent
        id={SHELL_IDS.activityDrawer}
        side="right"
        showCloseButton={false}
        aria-describedby={undefined}
        className="w-(--drawer-width) max-w-screen gap-0 sm:max-w-(--drawer-width)"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (!closedFromDrawer.current) return;
          closedFromDrawer.current = false;
          document.getElementById(SHELL_IDS.activityToggle)?.focus();
        }}
      >
        <SheetHeader className="h-(--page-header-height) shrink-0 flex-row items-center justify-between border-b border-border px-4 py-0">
          <SheetTitle className="text-lg leading-(--line-heading)">
            Activity
          </SheetTitle>
          <SheetClose asChild>
            <Button
              id="activity-drawer-close"
              variant="ghost"
              size="icon-md"
              aria-label="Close activity feed"
              className="text-muted-foreground"
            >
              <X />
            </Button>
          </SheetClose>
        </SheetHeader>
        <div
          aria-live="polite"
          aria-relevant="additions"
          className="scroll-stable-y min-h-0 flex-1 overflow-y-auto py-2"
        >
          {children}
        </div>
      </SheetContent>
    </Sheet>
  );
}
