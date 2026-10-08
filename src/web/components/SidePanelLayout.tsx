import type { ReactNode } from "react";
import { NARROW_QUERY } from "../../shared/media-queries.js";
import { useMediaQuery } from "@/components/ui/hooks/use-media-query";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";

interface SidePanelLayoutProps {
  main: ReactNode;
  panel: ReactNode;
  open: boolean;
  onClose: () => void;
  title: string;
  handleLabel: string;
}

const PANE = "flex h-full min-h-0 min-w-0 flex-col";

export function SidePanelLayout({
  main,
  panel,
  open,
  onClose,
  title,
  handleLabel,
}: SidePanelLayoutProps) {
  const narrow = useMediaQuery(NARROW_QUERY);

  if (narrow) {
    return (
      <>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">{main}</div>
        <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
          <SheetContent
            side="right"
            showCloseButton={false}
            aria-describedby={undefined}
            className="w-full max-w-screen gap-0 p-0 sm:max-w-screen"
          >
            <SheetTitle className="sr-only">{title}</SheetTitle>
            {panel}
          </SheetContent>
        </Sheet>
      </>
    );
  }

  if (!open) {
    return <div className="flex min-h-0 min-w-0 flex-1 flex-col">{main}</div>;
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <ResizablePanelGroup orientation="horizontal">
        <ResizablePanel minSize={320}>
          <div className={PANE}>{main}</div>
        </ResizablePanel>
        <ResizableHandle
          aria-label={handleLabel}
          className="[transition:var(--hover-transition)] data-[separator=active]:bg-primary data-[separator=hover]:bg-(--hover-resize-handle)"
        />
        <ResizablePanel
          defaultSize="36%"
          minSize={360}
          maxSize="70%"
          groupResizeBehavior="preserve-pixel-size"
        >
          <div className={`${PANE} border-l border-border`}>{panel}</div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
