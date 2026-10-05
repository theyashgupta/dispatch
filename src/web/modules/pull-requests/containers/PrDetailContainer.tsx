import { useState } from "react";
import type { PrReviewEvent } from "../../../../shared/types.js";
import type { PrRow } from "../../../../shared/pr-rows.js";
import { fixCiPrompt, reviewPrompt } from "../../../../shared/agent-prompt.js";
import { isWebUrl } from "../../../../shared/web-url.js";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useSingleFlight } from "@/queries/single-flight";
import {
  PrDetail,
  type PrComposer,
} from "@/modules/pull-requests/components/PrDetail";
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
  onStartAgent: (row: PrRow, prompt: string) => void;
  onNotice: (text: string) => void;
}

export function PrDetailContainer({
  row,
  onBack,
  onStartAgent,
  onNotice,
}: PrDetailContainerProps) {
  const [composer, setComposer] = useState<PrComposer>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmMerge, setConfirmMerge] = useState(false);

  const label = `${row.repo}#${row.number}`;
  const ref = { owner: row.owner, repo: row.name, number: row.number };
  const { data: result } = usePullRequestQuery(row.owner, row.name, row.number);
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
        busy={busy}
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
        onReviewWithAgent={() =>
          detail &&
          onStartAgent(row, reviewPrompt(detail, row.repo, row.number))
        }
        onFixCi={() =>
          detail && onStartAgent(row, fixCiPrompt(detail, row.repo, row.number))
        }
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
