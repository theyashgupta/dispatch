import { AlertTriangle, Play, RotateCw } from "lucide-react";
import type { Card as CardModel } from "../../shared/types.js";
import { startCard } from "../lib/api.js";
import { useResumeFeedback } from "../hooks/useResumeFeedback.js";
import { Button } from "../primitives/Button.js";
import { Notice } from "../primitives/Notice.js";

interface SessionLostSectionProps {
  card: CardModel;
  onStartRequest?: (id: string) => void;
}

export function SessionLostSection({
  card,
  onStartRequest,
}: SessionLostSectionProps) {
  const { resuming, resumeFailed, watchdogFired, failureCopy, onResume } =
    useResumeFeedback(card);
  const inResumableColumn =
    card.column === "in_review" || card.column === "in_planning";
  const canResume = inResumableColumn && Boolean(card.workspacePath);
  const workspaceGone = inResumableColumn && !card.workspacePath;

  function handleRestart() {
    if (card.workspace) {
      startCard(card.id, card.extraDirection ?? "").catch(console.error);
    } else {
      onStartRequest?.(card.id);
    }
  }

  let helper: string;
  if (canResume) {
    helper =
      "The tmux session ended (likely after a reboot). Resume continues the same Claude conversation in the same worktree — no kickoff prompt is re-sent.";
  } else if (workspaceGone) {
    helper =
      "The workspace is no longer available. Restart begins a fresh session in the same branch.";
  } else {
    helper =
      "The tmux session is gone (likely after a reboot). Restart resumes it in the same workspace and branch.";
  }

  return (
    <div
      style={{
        margin: "0 var(--space-xl) var(--space-xl)",
        paddingTop: "var(--space-lg)",
        borderTop: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-lg)",
      }}
    >
      <Notice
        tone="destructive"
        icon={
          <AlertTriangle
            size={12}
            strokeWidth={2}
            aria-hidden="true"
            style={{ flex: "0 0 auto" }}
          />
        }
        label="Session lost"
      />

      <div
        style={{
          fontSize: "var(--font-label)",
          fontWeight: "var(--weight-regular)",
          lineHeight: "var(--line-label)",
          color: "var(--text-muted)",
        }}
      >
        {helper}
      </div>

      {watchdogFired && (
        <Notice
          tone="destructive"
          label="Still resuming… the board may be catching up. Try Resume again."
        />
      )}

      {resumeFailed && <Notice tone="destructive" label={failureCopy} />}

      {canResume ? (
        <div style={{ display: "flex", gap: "var(--space-sm)" }}>
          <Button
            variant="primary"
            disabled={resuming}
            onClick={onResume}
            style={{ alignSelf: "flex-start" }}
          >
            <Play size={12} strokeWidth={2} aria-hidden="true" />
            {resuming ? "Resuming…" : "Resume"}
          </Button>
          {resumeFailed && (
            <Button
              variant="secondary"
              onClick={handleRestart}
              style={{ alignSelf: "flex-start" }}
            >
              <RotateCw size={12} strokeWidth={2} aria-hidden="true" />
              Restart
            </Button>
          )}
        </div>
      ) : (
        <Button
          variant="secondary"
          onClick={handleRestart}
          style={{ alignSelf: "flex-start" }}
        >
          <RotateCw size={12} strokeWidth={2} aria-hidden="true" />
          Restart
        </Button>
      )}
    </div>
  );
}
