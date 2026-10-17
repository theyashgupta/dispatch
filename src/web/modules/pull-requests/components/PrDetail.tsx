import { ArrowRight, ExternalLink } from "lucide-react";
import { formatAge, nowMs } from "../../../../shared/format-age.js";
import type {
  PrDetail as PrDetailModel,
  PrReviewEvent,
} from "../../../../shared/types.js";
import type { PrRow } from "../../../../shared/pr-rows.js";
import {
  DetailActions,
  DetailHeader,
  DetailScroll,
} from "@/components/DetailPaneBody";
import { LoadingButton } from "@/components/LoadingButton";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ExternalTextLink } from "@/components/ExternalTextLink";
import { PrAuthorAvatar } from "./PrAuthorAvatar";
import { PrChecks } from "./PrChecks";
import { PrDetailLoadError } from "./PrDetailLoadError";
import { PrDetailLoading } from "./PrDetailLoading";
import { PrFiles } from "./PrFiles";
import { PrOverviewTab } from "./PrOverviewTab";
import type { PrComposer } from "./PrReviewActions";
import { prStateBadge } from "@/modules/pull-requests/domain/pr-detail-state";
import {
  reviewButtonLabel,
  type ReviewStep,
} from "@/modules/pull-requests/domain/review-flow";

interface PrDetailProps {
  row: PrRow;
  label: string;
  detail: PrDetailModel | null;
  loading: boolean;
  loadError: string | null;
  retrying: boolean;
  busy: string | null;
  reviewBusy: boolean;
  reviewStep: ReviewStep | null;
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
  onRetry: () => void;
}

export function PrDetail({
  row,
  label,
  detail,
  loading,
  loadError,
  retrying,
  busy,
  reviewBusy,
  reviewStep,
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
  onRetry,
}: PrDetailProps) {
  const failing = detail?.checks.some((c) => c.state === "fail") ?? false;
  const state = detail ? prStateBadge(detail) : null;

  return (
    <DetailScroll testId="pr-detail">
      <DetailHeader onBack={onBack} title={row.title}>
        <ExternalTextLink href={row.url}>
          <span className="font-mono text-xs font-semibold">{label}</span>
        </ExternalTextLink>
        {state && <Badge tone={state.tone}>{state.label}</Badge>}
      </DetailHeader>
      {detail && (
        <div className="flex flex-wrap items-center gap-(--space-sm) text-sm text-muted-foreground">
          <PrAuthorAvatar
            author={detail.author}
            authorAvatar={row.authorAvatar}
          />
          <span>{detail.author}</span>
          <span aria-hidden="true">·</span>
          <span className="font-mono text-xs wrap-anywhere">{detail.head}</span>
          <ArrowRight className="size-3.5" role="img" aria-label="into" />
          <span className="font-mono text-xs wrap-anywhere">{detail.base}</span>
          <span aria-hidden="true">·</span>
          <span>
            +{detail.additions} -{detail.deletions}
          </span>
          <span aria-hidden="true">·</span>
          <span>{formatAge(row.createdAt, nowMs())}</span>
        </div>
      )}
      <DetailActions>
        <LoadingButton
          loading={reviewStep !== null}
          disabled={reviewBusy}
          onClick={onReviewWithAgent}
        >
          {reviewButtonLabel(reviewStep)}
        </LoadingButton>
        <LoadingButton
          variant="secondary"
          disabled={!failing}
          onClick={onFixCi}
        >
          Fix CI with agent
        </LoadingButton>
        <LoadingButton variant="secondary" onClick={onOpenOnGithub}>
          <ExternalLink aria-hidden="true" />
          Open on GitHub
        </LoadingButton>
      </DetailActions>
      {loading && <PrDetailLoading />}
      {loadError && (
        <PrDetailLoadError
          message={loadError}
          retrying={retrying}
          onRetry={onRetry}
          onOpenOnGithub={onOpenOnGithub}
        />
      )}
      {detail && (
        <Tabs defaultValue="overview" className="gap-(--space-md)">
          <TabsList
            variant="line"
            className="w-full flex-wrap justify-start group-data-[orientation=horizontal]/tabs:h-auto"
          >
            <TabsTrigger value="overview" className="flex-none">
              Overview
            </TabsTrigger>
            <TabsTrigger value="files" className="flex-none">
              Files
              <Badge tone="neutral">{detail.changedFiles}</Badge>
            </TabsTrigger>
            <TabsTrigger value="checks" className="flex-none">
              Checks
              <Badge tone="neutral">{detail.checks.length}</Badge>
              {failing && (
                <span
                  role="img"
                  aria-label="A check fails"
                  className="size-1.5 rounded-full bg-destructive"
                />
              )}
            </TabsTrigger>
          </TabsList>
          <PrOverviewTab
            row={row}
            detail={detail}
            open={detail.state === "open"}
            busy={busy}
            error={error}
            composer={composer}
            draft={draft}
            onApprove={onApprove}
            onOpenComposer={onOpenComposer}
            onDraftChange={onDraftChange}
            onSend={onSend}
            onCancelComposer={onCancelComposer}
            onSquashMerge={onSquashMerge}
          />
          <TabsContent value="files">
            <PrFiles detail={detail} />
          </TabsContent>
          <TabsContent value="checks">
            <PrChecks detail={detail} />
          </TabsContent>
        </Tabs>
      )}
    </DetailScroll>
  );
}
