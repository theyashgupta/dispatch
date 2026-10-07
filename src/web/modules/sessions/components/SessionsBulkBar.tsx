import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

interface SessionsBulkBarProps {
  count: number;
  tickets: number;
  cleanup: boolean;
  resume: boolean;
  onCleanup: () => void;
  onResume: () => void;
  onClear: () => void;
}

export function SessionsBulkBar({
  count,
  tickets,
  cleanup,
  resume,
  onCleanup,
  onResume,
  onClear,
}: SessionsBulkBarProps) {
  if (count === 0) return null;
  return (
    <Card
      data-testid="sessions-bulk-bar"
      className="fixed bottom-(--space-xl) left-1/2 z-5 w-max max-w-[calc(100vw_-_2*var(--space-lg))] -translate-x-1/2 flex-row flex-wrap items-center justify-center gap-(--space-lg) px-(--space-lg) py-(--space-sm) shadow-(--shadow-float)"
    >
      <span className="text-sm font-semibold text-muted-foreground">
        {count} selected
      </span>
      <Button size="sm" disabled={!cleanup} onClick={onCleanup}>
        {`Clean up (${tickets})`}
      </Button>
      <Button
        variant="secondary"
        size="sm"
        disabled={!resume}
        onClick={onResume}
      >
        {`Resume lost (${tickets})`}
      </Button>
      <Button
        variant="ghost"
        size="icon-md"
        aria-label="Clear selection"
        onClick={onClear}
      >
        <X className="size-4" aria-hidden="true" />
      </Button>
    </Card>
  );
}
