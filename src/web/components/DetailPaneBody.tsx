import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

interface DetailScrollProps {
  testId?: string;
  children: ReactNode;
}

interface DetailHeaderProps {
  title: ReactNode;
  onBack?: () => void;
  children: ReactNode;
}

interface DetailPartProps {
  children: ReactNode;
}

export function DetailScroll({ testId, children }: DetailScrollProps) {
  return (
    <ScrollArea
      data-testid={testId}
      className="min-h-0 min-w-0 flex-1 [&_[data-slot=scroll-area-viewport]>div]:block!"
    >
      <div className="flex min-w-0 flex-col gap-4 p-4">{children}</div>
    </ScrollArea>
  );
}

export function DetailActions({ children }: DetailPartProps) {
  return <div className="flex flex-wrap gap-2">{children}</div>;
}

export function DetailPlaceholder({ children }: DetailPartProps) {
  return (
    <div className="px-4 py-12 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

export function DetailHeader({ title, onBack, children }: DetailHeaderProps) {
  return (
    <>
      {onBack && (
        <div>
          <Button variant="secondary" onClick={onBack}>
            Back
          </Button>
        </div>
      )}
      <div className="flex flex-col gap-1">
        <h2 className="m-0 text-lg leading-tight font-semibold wrap-anywhere text-foreground">
          {title}
        </h2>
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          {children}
        </div>
      </div>
    </>
  );
}
