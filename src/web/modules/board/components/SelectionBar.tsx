import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

interface SelectionBarProps {
  count: number;
  onStartGroup: () => void;
  onClear: () => void;
}

export function SelectionBar({
  count,
  onStartGroup,
  onClear,
}: SelectionBarProps) {
  if (count < 2) return null;
  return (
    <Card className="fixed bottom-(--space-xl) left-1/2 z-5 w-max max-w-[calc(100vw_-_2*var(--space-lg))] -translate-x-1/2 flex-row flex-wrap items-center justify-center gap-(--space-lg) px-(--space-lg) py-(--space-sm) shadow-(--shadow-float)">
      <span className="text-sm font-semibold text-muted-foreground">
        {count} selected
      </span>
      <Button size="sm" onClick={onStartGroup}>
        {`Start ${count} as group`}
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
