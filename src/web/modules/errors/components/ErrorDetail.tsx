import type { SentryIssueDetail } from "../../../../shared/types.js";
import { formatAge, nowMs } from "../../../../shared/format-age.js";
import {
  SNOOZE_LABELS,
  SNOOZE_PRESETS,
  type SnoozePreset,
} from "../../../../shared/snooze.js";
import { isWebUrl } from "../../../../shared/web-url.js";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import {
  DetailActions,
  DetailHeader,
  DetailScroll,
} from "@/components/DetailPaneBody";
import { ErrorAlert } from "@/components/ErrorAlert";
import { LoadingButton } from "@/components/LoadingButton";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { FrameCode } from "./FrameCode";
import { levelTone, type ErrorRow } from "@/modules/errors/domain/error-rows";
import {
  exceptionLine,
  frameLabel,
} from "@/modules/errors/domain/sentry-context";

interface ErrorDetailProps {
  row: ErrorRow;
  detail: SentryIssueDetail | null;
  loading: boolean;
  loadError: string | null;
  busy: string | null;
  error: string | null;
  snoozeOpen: boolean;
  onBack?: () => void;
  onFixWithAgent: () => void;
  onCreateTicket: () => void;
  onResolve: () => void;
  onToggleSnooze: () => void;
  onSnooze: (preset: SnoozePreset) => void;
  onOpenInSentry: () => void;
}

const MUTED = "shrink-0 text-base text-muted-foreground";
const LIST_LINE =
  "flex min-w-0 gap-2 py-1 text-sm wrap-anywhere text-foreground";

function relative(iso: string | null): string {
  return iso ? formatAge(iso, nowMs()) : "unknown";
}

export function ErrorDetail({
  row,
  detail,
  loading,
  loadError,
  busy,
  error,
  snoozeOpen,
  onBack,
  onFixWithAgent,
  onCreateTicket,
  onResolve,
  onToggleSnooze,
  onSnooze,
  onOpenInSentry,
}: ErrorDetailProps) {
  const inApp = detail?.frames.filter((f) => f.inApp) ?? [];
  const other = detail?.frames.filter((f) => !f.inApp) ?? [];

  return (
    <DetailScroll testId="error-detail">
      <DetailHeader
        onBack={onBack}
        title={row.shortId ? `${row.shortId} ${row.title}` : row.title}
      >
        <Badge tone={levelTone(row.level)}>{row.level || "unknown"}</Badge>
        {row.project && <Badge tone="neutral">{row.project}</Badge>}
        {detail && (
          <span data-testid="error-impact">
            {detail.count} events, {detail.userCount} users, first seen{" "}
            {relative(detail.firstSeen)}, last seen {relative(detail.lastSeen)}
          </span>
        )}
      </DetailHeader>
      {loading && <Spinner />}
      {loadError && <ErrorAlert>{loadError}</ErrorAlert>}
      <DetailActions>
        <LoadingButton
          disabled={busy !== null || !detail}
          onClick={onFixWithAgent}
        >
          Fix with agent
        </LoadingButton>
        <LoadingButton
          variant="secondary"
          disabled={busy !== null || !detail}
          loading={busy === "ticket"}
          onClick={onCreateTicket}
        >
          Create ticket
        </LoadingButton>
        <LoadingButton
          variant="secondary"
          disabled={busy !== null}
          loading={busy === "resolve"}
          onClick={onResolve}
        >
          Resolve in Sentry
        </LoadingButton>
        <LoadingButton
          variant="secondary"
          disabled={busy !== null}
          aria-expanded={snoozeOpen}
          onClick={onToggleSnooze}
        >
          Snooze
        </LoadingButton>
        {isWebUrl(row.url) && (
          <LoadingButton variant="secondary" onClick={onOpenInSentry}>
            Open in Sentry
          </LoadingButton>
        )}
      </DetailActions>
      {snoozeOpen && (
        <DetailActions>
          {SNOOZE_PRESETS.map((preset) => (
            <LoadingButton
              key={preset}
              variant="secondary"
              disabled={busy !== null}
              onClick={() => onSnooze(preset)}
            >
              {SNOOZE_LABELS[preset]}
            </LoadingButton>
          ))}
        </DetailActions>
      )}
      {error && <ErrorAlert>{error}</ErrorAlert>}
      {detail && (
        <>
          <pre
            className="m-0 shrink-0 overflow-x-auto rounded-md border-l-2 border-destructive bg-sidebar p-2 font-mono text-sm leading-snug wrap-anywhere whitespace-pre-wrap text-foreground"
            data-testid="error-exception"
          >
            {exceptionLine(detail)}
            {detail.culprit ? `\n${detail.culprit}` : ""}
          </pre>
          <CollapsibleSection
            title="Breadcrumbs"
            badge={<Badge tone="neutral">{detail.breadcrumbs.length}</Badge>}
            defaultOpen
          >
            {detail.breadcrumbs.length === 0 ? (
              <div className={MUTED}>No breadcrumbs</div>
            ) : (
              detail.breadcrumbs.map((b, index) => (
                <div key={index} className={LIST_LINE}>
                  <span className={MUTED}>
                    {[b.timestamp ? relative(b.timestamp) : null, b.category]
                      .filter(Boolean)
                      .join(" ")}
                  </span>
                  <span>{b.message ?? ""}</span>
                </div>
              ))
            )}
          </CollapsibleSection>
          <CollapsibleSection
            title="Stack trace"
            badge={<Badge tone="neutral">{detail.frames.length}</Badge>}
            defaultOpen
          >
            {inApp.map((frame, index) => (
              <CollapsibleSection key={`in-${index}`} title={frameLabel(frame)}>
                <FrameCode frame={frame} />
              </CollapsibleSection>
            ))}
            {other.length > 0 && (
              <CollapsibleSection title={`Other frames (${other.length})`}>
                {other.map((frame, index) => (
                  <div key={`other-${index}`} className={LIST_LINE}>
                    {frameLabel(frame)}
                  </div>
                ))}
              </CollapsibleSection>
            )}
            {detail.frames.length === 0 && (
              <div className={MUTED}>No stack trace</div>
            )}
          </CollapsibleSection>
          {detail.tags.length > 0 && (
            <div className="flex flex-wrap gap-1" data-testid="error-tags">
              {detail.tags.map((tag) => (
                <Badge key={`${tag.key}=${tag.value}`} tone="neutral">
                  {tag.key}={tag.value}
                </Badge>
              ))}
            </div>
          )}
        </>
      )}
    </DetailScroll>
  );
}
