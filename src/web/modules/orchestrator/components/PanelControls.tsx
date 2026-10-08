import { Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { PanelControl } from "@/modules/orchestrator/domain/panel-model";

interface PanelControlsProps {
  control: PanelControl | null;
  loading: boolean;
  onRun: (kind: PanelControl["kind"]) => void;
}

export function PanelControls({ control, loading, onRun }: PanelControlsProps) {
  if (loading) return <Skeleton className="h-8 w-40 self-end" />;
  if (control === null) return null;
  const reasonId = `orchestrator-${control.kind}-reason`;
  const button = (
    <Button
      size="sm"
      variant={control.kind === "start" ? "default" : "outline"}
      disabled={control.disabled}
      aria-describedby={control.reason === null ? undefined : reasonId}
      onClick={() => onRun(control.kind)}
    >
      {control.kind === "stop" && <Square aria-hidden="true" />}
      {control.label}
    </Button>
  );
  return (
    <div className="flex flex-col items-end gap-(--space-xs)">
      {control.tooltip === null ? (
        button
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex">{button}</span>
          </TooltipTrigger>
          <TooltipContent>{control.tooltip}</TooltipContent>
        </Tooltip>
      )}
      {control.reason !== null && (
        <p
          id={reasonId}
          className="m-0 text-right text-sm text-muted-foreground"
        >
          {control.reason}
        </p>
      )}
    </div>
  );
}
