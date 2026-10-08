import { useState } from "react";
import { Card } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import type { TerminalMode } from "@/modules/orchestrator/domain/panel-model";

interface TerminalFrameProps {
  mode: TerminalMode;
  src: string | null;
  loading: boolean;
}

export function TerminalFrame({ mode, src, loading }: TerminalFrameProps) {
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  if (loading) {
    return <Skeleton className="min-h-60 flex-1" />;
  }
  if (mode === "empty") {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>No orchestrator on this board</EmptyTitle>
          <EmptyDescription>
            An orchestrator plans the tickets of this board, starts loops and
            answers their questions. It cannot change code or this policy.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  if (mode === "unavailable") {
    return null;
  }
  if (mode === "not-running" || mode === "resume") {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>The orchestrator is not running</EmptyTitle>
          <EmptyDescription>
            {mode === "resume"
              ? "Resume the orchestrator to open its terminal."
              : "Start the orchestrator to open its terminal."}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  const ready = src !== null && loadedSrc === src;
  return (
    <Card
      aria-label="Orchestrator terminal"
      role="group"
      className="relative min-h-60 flex-1 gap-0 overflow-hidden bg-background p-0"
    >
      {src !== null && (
        <iframe
          src={src}
          title="Orchestrator terminal"
          sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
          className="min-h-0 w-full flex-auto border-0"
          onLoad={() => setLoadedSrc(src)}
        />
      )}
      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center gap-(--space-sm) bg-background text-sm text-muted-foreground">
          <Spinner />
          <span>Connecting to the orchestrator terminal</span>
        </div>
      )}
    </Card>
  );
}
