import type { PrDetail as PrDetailModel } from "../../../../shared/types.js";
import type { PrRow } from "../../../../shared/pr-rows.js";
import type { PrReviewEvent } from "../../../../shared/types.js";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import {
  DetailActions,
  DetailHeader,
  DetailScroll,
} from "@/components/DetailPaneBody";
import { ErrorAlert } from "@/components/ErrorAlert";
import { LoadingButton } from "@/components/LoadingButton";
import { Markdown } from "@/components/markdown/Markdown";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { ExternalTextLink } from "@/components/ExternalTextLink";
import { PrChecks } from "./PrChecks";
import { PrFiles } from "./PrFiles";
import { prStateBadge } from "@/modules/pull-requests/domain/pr-detail-state";

export type PrComposer = "REQUEST_CHANGES" | "COMMENT" | null;

interface PrDetailProps {
  row: PrRow;
  label: string;
  detail: PrDetailModel | null;
  loading: boolean;
  loadError: string | null;
  busy: string | null;
  error: string | null;
  composer: PrComposer;
  draft: string;
  onBack?: () => void;
  onApprove: () => void;
  onOpenComposer: (composer: Exclude<PrComposer, null>) => void;
  onDraftChange: (value: string) => void;
  onSend: (event: PrReviewEvent) => void;
  onCancelComposer: () => void;
  onSquashMerge: () => void;
  onReviewWithAgent: () => void;
  onFixCi: () => void;
  onOpenOnGithub: () => void;
}

export function PrDetail({
  row,
  label,
  detail,
  loading,
  loadError,
  busy,
  error,
  composer,
  draft,
  onBack,
  onApprove,
  onOpenComposer,
  onDraftChange,
  onSend,
  onCancelComposer,
  onSquashMerge,
  onReviewWithAgent,
  onFixCi,
  onOpenOnGithub,
}: PrDetailProps) {
  const failing = detail?.checks.some((c) => c.state === "fail") ?? false;
  const open = detail?.state === "open";
  const state = detail ? prStateBadge(detail) : null;

  return (
    <DetailScroll testId="pr-detail">
      <DetailHeader onBack={onBack} title={row.title}>
        <ExternalTextLink href={row.url}>{label}</ExternalTextLink>
        {detail && state && (
          <>
            <span>{detail.author}</span>
            <span>
              {detail.head} into {detail.base}
            </span>
            <span>
              +{detail.additions} -{detail.deletions}
            </span>
            <Badge tone={state.tone}>{state.label}</Badge>
          </>
        )}
      </DetailHeader>
      {loading && <Spinner />}
      {loadError && <ErrorAlert>{loadError}</ErrorAlert>}
      {detail && (
        <>
          <DetailActions>
            <LoadingButton
              variant="secondary"
              disabled={!open || busy !== null}
              loading={busy === "APPROVE"}
              onClick={onApprove}
            >
              Approve
            </LoadingButton>
            <LoadingButton
              variant="secondary"
              disabled={!open || busy !== null}
              aria-pressed={composer === "REQUEST_CHANGES"}
              onClick={() => onOpenComposer("REQUEST_CHANGES")}
            >
              Request changes
            </LoadingButton>
            <LoadingButton
              variant="secondary"
              disabled={!open || busy !== null}
              aria-pressed={composer === "COMMENT"}
              onClick={() => onOpenComposer("COMMENT")}
            >
              Comment
            </LoadingButton>
            <LoadingButton
              disabled={!open || busy !== null}
              onClick={onSquashMerge}
            >
              Squash merge
            </LoadingButton>
            <LoadingButton variant="secondary" onClick={onReviewWithAgent}>
              Review with agent
            </LoadingButton>
            <LoadingButton
              variant="secondary"
              disabled={!failing}
              onClick={onFixCi}
            >
              Fix CI with agent
            </LoadingButton>
            <LoadingButton variant="secondary" onClick={onOpenOnGithub}>
              Open on GitHub
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
          <CollapsibleSection title="Description" defaultOpen>
            {detail.body.trim() ? (
              <Markdown source={detail.body} />
            ) : (
              <div className="text-base text-muted-foreground">
                No description
              </div>
            )}
          </CollapsibleSection>
          <PrChecks detail={detail} failing={failing} />
          <PrFiles detail={detail} />
        </>
      )}
    </DetailScroll>
  );
}
