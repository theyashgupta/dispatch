import { LoaderCircle, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { SessionStateBadge } from "@/components/badges/SessionStateBadge";
import type { SupervisorState } from "../../../../shared/types.js";

interface PanelHeaderProps {
  boardName: string;
  state: SupervisorState | null;
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
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-(--space-sm) pr-(--space-sm)">
        <Badge
          tone="neutral"
          title={boardName}
          className="block min-w-0 shrink truncate"
        >
          {boardName}
        </Badge>
        {loading ? (
          <Skeleton className="h-4.5 w-20" />
        ) : (
          <>
            {state !== null && <SessionStateBadge state={state} />}
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
