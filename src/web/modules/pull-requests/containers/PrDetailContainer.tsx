import { useState } from "react";
import type { PrReviewEvent } from "../../../../shared/types.js";
import type { PrRow } from "../../../../shared/pr-rows.js";
import { fixCiPrompt } from "../../../../shared/agent-prompt.js";
import { isWebUrl } from "../../../../shared/web-url.js";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useSingleFlight } from "@/queries/single-flight";
import { PrDetail } from "@/modules/pull-requests/components/PrDetail";
import type { PrComposer } from "@/modules/pull-requests/components/PrReviewActions";
import type { ReviewStep } from "@/modules/pull-requests/domain/review-flow";
import { prFailureText } from "@/modules/pull-requests/domain/pr-error-copy";
import { reviewNotice } from "@/modules/pull-requests/domain/pr-detail-state";
import {
  useMergePullRequestMutation,
  useReviewPullRequestMutation,
  usePullRequestQuery,
} from "@/modules/pull-requests/queries/pull-requests-queries";

interface PrDetailContainerProps {
  row: PrRow;
  onBack?: () => void;
  reviewBusy: boolean;
  reviewStep: ReviewStep | null;
  onReview: (row: PrRow) => void;
  onStartAgent: (row: PrRow, prompt: string) => void;
  onNotice: (text: string) => void;
}

export function PrDetailContainer({
  row,
  onBack,
  reviewBusy,
  reviewStep,
  onReview,
  onStartAgent,
  onNotice,
}: PrDetailContainerProps) {
  const [composer, setComposer] = useState<PrComposer>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmMerge, setConfirmMerge] = useState(false);

  const label = `${row.repo}#${row.number}`;
  const ref = { owner: row.owner, repo: row.name, number: row.number };
  const {
    data: result,
    refetch,
    isFetching,
  } = usePullRequestQuery(row.owner, row.name, row.number);
  const detail = result?.ok ? result.detail : null;
  const loadError =
    result && !result.ok
      ? prFailureText(result.error, result.message, result.ssoUrl)
      : null;

  const review = useReviewPullRequestMutation((outcome, vars) => {
    if (!outcome.ok) {
      setError(prFailureText(outcome.error, outcome.message, outcome.ssoUrl));
      return;
    }
    setComposer(null);
    setDraft("");
    onNotice(reviewNotice(vars.event, label));
  });
  const merge = useMergePullRequestMutation((outcome) => {
    if (!outcome.ok) {
      setError(prFailureText(outcome.error, outcome.message, outcome.ssoUrl));
      return;
    }
    onNotice(`Merged ${label}.`);
  });
  const submitReview = useSingleFlight(review.mutate);
  const submitMerge = useSingleFlight(merge.mutate);

  const busy = review.isPending
    ? (review.variables?.event ?? null)
    : merge.isPending
      ? "MERGE"
      : null;

  function handleReview(event: PrReviewEvent, body?: string) {
    setError(null);
    submitReview({ ...ref, event, body });
  }

  function handleMerge() {
    if (!detail) return;
    setError(null);
    submitMerge(
      { ...ref, sha: detail.headSha },
      { onSettled: () => setConfirmMerge(false) },
    );
  }

  return (
    <>
      <PrDetail
        row={row}
        label={label}
        detail={detail}
        loading={result === undefined}
        loadError={loadError}
        retrying={isFetching}
        busy={busy}
        reviewBusy={reviewBusy}
        reviewStep={reviewStep}
        error={error}
        composer={composer}
        draft={draft}
        onBack={onBack}
        onApprove={() => handleReview("APPROVE")}
        onOpenComposer={setComposer}
        onDraftChange={setDraft}
        onSend={(event) => handleReview(event, draft.trim())}
        onCancelComposer={() => {
          setComposer(null);
          setDraft("");
        }}
        onSquashMerge={() => setConfirmMerge(true)}
        onReviewWithAgent={() => onReview(row)}
        onFixCi={() =>
          detail && onStartAgent(row, fixCiPrompt(detail, row.repo, row.number))
        }
        onRetry={() => void refetch()}
        onOpenOnGithub={() => {
          if (isWebUrl(row.url)) window.open(row.url, "_blank", "noopener");
        }}
      />
      {confirmMerge && detail && (
        <ConfirmDialog
          label="Squash merge pull request"
          title={`Squash and merge ${label}?`}
          description={`${row.title} will be squashed into one commit on ${detail.base}. This cannot be undone from Dispatch.`}
          cancelLabel="Cancel"
          confirmLabel="Squash and merge"
          pendingLabel="Squash and merge"
          pending={merge.isPending}
          onClose={() => {
            if (!merge.isPending) setConfirmMerge(false);
          }}
          onConfirm={handleMerge}
        />
      )}
    </>
  );
}
