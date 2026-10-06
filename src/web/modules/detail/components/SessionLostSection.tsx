import { Play, RotateCw } from "lucide-react";
import type { Card as CardModel } from "../../../../shared/types.js";
import { Button } from "@/components/ui/button";
import {
  useResumeFeedback,
  type ResumeOutcome,
} from "@/components/ui/hooks/use-resume-feedback";
import { PanelAlert } from "./PanelNotice";

interface SessionLostSectionProps {
  card: CardModel;
  resume: (id: string) => Promise<ResumeOutcome>;
  onRestart: (card: CardModel) => void;
}

export function SessionLostSection({
  card,
  resume,
  onRestart,
}: SessionLostSectionProps) {
  const { resuming, resumeFailed, watchdogFired, failureCopy, onResume } =
    useResumeFeedback(card, resume);
  const canResume = Boolean(card.workspacePath);

  const helper = canResume
    ? "The tmux session ended (likely after a reboot). Resume continues the same Claude conversation in the same worktree. No kickoff prompt is re-sent."
    : "The workspace is no longer available. Restart begins a fresh session in the same branch.";

  const restartButton = (
    <Button
      variant="outline"
      size="sm"
      className="self-start"
      onClick={() => onRestart(card)}
    >
      <RotateCw className="size-3" aria-hidden="true" />
      Restart
    </Button>
  );

  return (
    <div className="mx-(--space-lg) mt-0 mb-(--space-xl) flex flex-col gap-(--space-lg) border-t border-border pt-(--space-xl)">
      <PanelAlert icon>Session lost</PanelAlert>

      <div className="text-sm font-normal text-muted-foreground">{helper}</div>

      {watchdogFired && (
        <PanelAlert>
          Still resuming… the board may be catching up. Try Resume again.
        </PanelAlert>
      )}

      {resumeFailed && <PanelAlert>{failureCopy}</PanelAlert>}

      {canResume ? (
        <div className="flex gap-(--space-sm)">
          <Button
            size="sm"
            className="self-start"
            disabled={resuming}
            onClick={onResume}
          >
            <Play className="size-3" aria-hidden="true" />
            {resuming ? "Resuming…" : "Resume"}
          </Button>
          {resumeFailed && restartButton}
        </div>
      ) : (
        restartButton
      )}
    </div>
  );
}
