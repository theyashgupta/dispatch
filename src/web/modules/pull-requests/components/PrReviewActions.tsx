import type { PrReviewEvent } from "../../../../shared/types.js";
import { DetailActions } from "@/components/DetailPaneBody";
import { ErrorAlert } from "@/components/ErrorAlert";
import { LoadingButton } from "@/components/LoadingButton";
import { Textarea } from "@/components/ui/textarea";

export type PrComposer = "REQUEST_CHANGES" | "COMMENT" | null;

export interface PrReviewActionsProps {
  open: boolean;
  busy: string | null;
  error: string | null;
  composer: PrComposer;
  draft: string;
  onApprove: () => void;
  onOpenComposer: (composer: Exclude<PrComposer, null>) => void;
  onDraftChange: (value: string) => void;
  onSend: (event: PrReviewEvent) => void;
  onCancelComposer: () => void;
  onSquashMerge: () => void;
}

export function PrReviewActions({
  open,
  busy,
  error,
  composer,
  draft,
  onApprove,
  onOpenComposer,
  onDraftChange,
  onSend,
  onCancelComposer,
  onSquashMerge,
}: PrReviewActionsProps) {
  const locked = !open || busy !== null;

  return (
    <>
      <h3 className="m-0 text-sm font-semibold text-foreground">
        Review on GitHub
      </h3>
      <DetailActions>
        <LoadingButton
          variant="secondary"
          disabled={locked}
          loading={busy === "APPROVE"}
          onClick={onApprove}
        >
          Approve
        </LoadingButton>
        <LoadingButton
          variant="secondary"
          disabled={locked}
          aria-pressed={composer === "REQUEST_CHANGES"}
          onClick={() => onOpenComposer("REQUEST_CHANGES")}
        >
          Request changes
        </LoadingButton>
        <LoadingButton
          variant="secondary"
          disabled={locked}
          aria-pressed={composer === "COMMENT"}
          onClick={() => onOpenComposer("COMMENT")}
        >
          Comment
        </LoadingButton>
        <LoadingButton
          variant="secondary"
          disabled={locked}
          onClick={onSquashMerge}
        >
          Squash merge
        </LoadingButton>
      </DetailActions>
      {composer && (
        <div className="flex flex-col gap-2">
          <Textarea
            aria-label={
              composer === "COMMENT" ? "Comment" : "Requested changes"
            }
            value={draft}
            maxLength={20000}
            className="min-h-24"
            onChange={(event) => onDraftChange(event.target.value)}
          />
          <DetailActions>
            <LoadingButton
              disabled={draft.trim() === "" || busy !== null}
              loading={busy === composer}
              onClick={() => onSend(composer)}
            >
              Send
            </LoadingButton>
            <LoadingButton variant="secondary" onClick={onCancelComposer}>
              Cancel
            </LoadingButton>
          </DetailActions>
        </div>
      )}
      {error && <ErrorAlert>{error}</ErrorAlert>}
    </>
  );
}
