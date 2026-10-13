import { Fragment, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface HeaderStripProps {
  boardName: string | null;
  staleText: string | null;
  facts: string[];
  needsCount: number;
  needsText: string | null;
  onNeedsClick: () => void;
}

export function HeaderStrip({
  boardName,
  staleText,
  facts,
  needsCount,
  needsText,
  onNeedsClick,
}: HeaderStripProps) {
  const items: ReactNode[] = facts.map((fact) => <span>{fact}</span>);
  if (staleText !== null) items.unshift(<span role="status">{staleText}</span>);
  if (needsText !== null) {
    items.push(
      <Button
        type="button"
        variant="link"
        size="sm"
        className="h-auto gap-1.5 p-0 text-sm"
        onClick={onNeedsClick}
      >
        <span
          aria-hidden="true"
          className={cn(
            "size-2 shrink-0 rounded-full",
            needsCount > 0 ? "bg-(--destructive)" : "bg-(--text-muted)",
          )}
        />
        {needsText}
      </Button>,
    );
  }
  return (
    <header className="flex flex-col gap-1">
      {boardName !== null && (
        <p className="m-0 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
          {boardName}
        </p>
      )}
      <h2 className="m-0 text-(length:--font-page-title) leading-(--line-display) font-semibold text-foreground">
        Project map
      </h2>
      {items.length > 0 && (
        <p className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground tabular-nums">
          {items.map((item, index) => (
            <Fragment key={index}>
              {index > 0 && <span aria-hidden="true">·</span>}
              {item}
            </Fragment>
          ))}
        </p>
      )}
    </header>
  );
}
