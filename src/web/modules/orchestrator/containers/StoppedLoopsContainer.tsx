import { toast } from "sonner";
import { StoppedLoops } from "@/modules/orchestrator/components/StoppedLoops";
import {
  REPLY_COPY,
  stoppedLoopText,
  type StoppedLoop,
} from "@/modules/orchestrator/domain/decision-view";
import { actionErrorCopy } from "@/modules/orchestrator/domain/panel-model";
import { useResumeLoopMutation } from "@/modules/orchestrator/queries/orchestrator-queries";

interface StoppedLoopsContainerProps {
  loops: readonly StoppedLoop[];
  stale: boolean;
}

function formatTime(iso: string | null): string {
  if (iso === null) return "an unknown time";
  return new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function StoppedLoopsContainer({
  loops,
  stale,
}: StoppedLoopsContainerProps) {
  const resume = useResumeLoopMutation();

  async function onResume(cardId: string): Promise<void> {
    const result = await resume.mutateAsync(cardId);
    if (!result.ok) {
      toast.error(actionErrorCopy("Resume loop", result.reason), {
        action: { label: "Try again", onClick: () => void onResume(cardId) },
      });
    } else if (result.result === "unconfirmed") {
      toast.error(REPLY_COPY.unconfirmed);
    }
  }

  return (
    <StoppedLoops
      rows={loops.map((loop) => ({
        cardId: loop.cardId,
        text: stoppedLoopText(loop, formatTime(loop.stoppedAt)),
      }))}
      disabled={stale || resume.isPending}
      onResume={(cardId) => void onResume(cardId)}
    />
  );
}
