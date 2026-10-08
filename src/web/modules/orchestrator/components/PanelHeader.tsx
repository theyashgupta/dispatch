import { LoaderCircle, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { StateLabel } from "@/modules/orchestrator/domain/session-state-label";
import { StateBadge } from "./StateBadge";

interface PanelHeaderProps {
  boardName: string;
  state: StateLabel | null;
  transition: string | null;
  staleBadge: string | null;
  loading: boolean;
  onClose: () => void;
}

export function PanelHeader({
  boardName,
  state,
  transition,
  staleBadge,
  loading,
  onClose,
}: PanelHeaderProps) {
  return (
    <div className="flex min-w-0 items-center gap-(--space-sm)">
      <h2 className="m-0 shrink-0 text-lg font-semibold text-foreground">
        Orchestrator
      </h2>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-(--space-sm)">
        <Badge tone="neutral" className="min-w-0 truncate">
          {boardName}
        </Badge>
        {loading ? (
          <Skeleton className="h-4.5 w-20" />
        ) : (
          <>
            {state !== null && <StateBadge state={state} />}
            {transition !== null && (
              <Badge tone="neutral">
                <LoaderCircle aria-hidden="true" />
                {transition}
              </Badge>
            )}
          </>
        )}
        {staleBadge !== null && <Badge tone="neutral">{staleBadge}</Badge>}
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-md"
            aria-label="Close orchestrator panel"
            className="shrink-0 text-muted-foreground"
            onClick={onClose}
          >
            <X aria-hidden="true" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Close orchestrator panel</TooltipContent>
      </Tooltip>
    </div>
  );
}
