import {
  Activity,
  Check,
  ChevronDown,
  ChevronRight,
  Play,
  RotateCw,
  TriangleAlert,
} from "lucide-react";
import type {
  Card as CardModel,
  Column as ColumnId,
} from "../../../../shared/types.js";
import { formatAge, nowMs } from "../../../../shared/format-age.js";
import { formatCleanupCountdown } from "../../../../shared/format-cleanup-countdown.js";
import {
  errorCopy,
  needsAttention as getNeedsAttention,
} from "../../../../shared/card-attention.js";
import { cardPrs } from "../../../../shared/card-prs.js";
import { GoneBadge } from "@/components/badges/GoneBadge";
import { LinearStateChip } from "@/components/badges/LinearStateChip";
import { PrBadge } from "@/components/badges/PrBadge";
import {
  PrOverflowChip,
  PR_CHIP_CAP,
} from "@/components/badges/PrOverflowChip";
import { PreviewBadge } from "@/components/badges/PreviewBadge";
import { SourceBadge } from "@/components/badges/SourceBadge";
import { TeamCycleText } from "@/components/badges/TeamCycleText";
import { UnknownProbeBadge } from "@/components/badges/UnknownProbeBadge";
import { PRIORITY_DOT } from "@/components/badges/priority-dot";
import { MemberRow } from "@/components/MemberRow";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, cardVariants } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { isMultiSelectable } from "@/modules/board/domain/drag-selection";
import { GroupPrRow } from "./GroupPrRow";
import { MoveToPicker } from "./MoveToPicker";

interface CardViewProps {
  card: CardModel;
  selected: boolean;
  multiSelected?: boolean;
  showDot: boolean;
  showGone: boolean;
  hover: boolean;
  pressed?: boolean;
  elevated?: boolean;
  dimmed?: boolean;
  rootRef?: React.Ref<HTMLDivElement>;
  domProps?: Omit<React.HTMLAttributes<HTMLDivElement>, "style" | "className">;
  expanded?: boolean;
  onToggleExpand?: () => void;
  members?: CardModel[];
  isCarousel?: boolean;
  resuming?: boolean;
  resumeFailed?: boolean;
  watchdogFired?: boolean;
  resumeFailureCopy?: string;
  onSelect?: (id: string) => void;
  onMoveTo?: (cardId: string, column: ColumnId) => void;
  onRetryStart?: (card: CardModel) => void;
  onRestart?: (card: CardModel) => void;
  onResume?: () => void;
}

const NOTICE_ALERT_CLASS =
  "items-center has-[>svg]:grid-cols-[--spacing(3)_1fr] has-[>svg]:gap-x-1 [&>svg]:size-3 [&>svg]:shrink-0 [&>svg]:translate-y-0";
const NOTICE_TITLE_CLASS =
  "line-clamp-none leading-(--line-label) font-semibold tracking-normal";
const MUTED_LINE_CLASS =
  "mt-(--space-xs) truncate text-sm font-normal text-muted-foreground";

interface CardNoticeProps {
  variant?: "destructive" | "muted";
  icon?: boolean;
  children: React.ReactNode;
}

function CardNotice({
  variant = "destructive",
  icon = false,
  children,
}: CardNoticeProps) {
  return (
    <Alert variant={variant} className={NOTICE_ALERT_CLASS}>
      {icon && <TriangleAlert aria-hidden="true" />}
      <AlertTitle className={NOTICE_TITLE_CLASS}>{children}</AlertTitle>
    </Alert>
  );
}

export function CardView({
  card,
  selected,
  multiSelected = false,
  showDot,
  showGone,
  hover,
  pressed = false,
  elevated = false,
  dimmed = false,
  rootRef,
  domProps,
  expanded,
  onToggleExpand,
  members,
  isCarousel = false,
  resuming = false,
  resumeFailed = false,
  watchdogFired = false,
  resumeFailureCopy,
  onSelect,
  onMoveTo,
  onRetryStart,
  onRestart,
  onResume,
}: CardViewProps) {
  const compact = card.column === "done";
  const isGroup = card.source === "group";
  const prs = cardPrs(card);
  const showRepo = new Set(prs.map((pr) => pr.repo)).size > 1;
  const selectable = isMultiSelectable(card);
  const needsAttention = getNeedsAttention(card);
  const priorityDot = isGroup ? undefined : PRIORITY_DOT[card.priority];
  const memberCount = members?.length ?? 0;
  const startError = card.startError;
  const startErrorCopy =
    startError != null ? errorCopy(startError, card.identifier) : null;
  const sessionCountSuffix =
    card.sessionCount != null ? ` · ${card.sessionCount}` : "";
  const sessionChipTitle = (label: string): string | undefined =>
    card.sessionCount != null
      ? `${label} · ${card.sessionCount} sessions`
      : undefined;
  const sessionChip =
    card.provisioningStep != null ? (
      <Badge tone="neutral" title={sessionChipTitle("Provisioning")}>
        <RotateCw aria-hidden="true" />
        {`Provisioning${sessionCountSuffix}`}
      </Badge>
    ) : card.sessionLost === true ? (
      <Badge tone="danger" title={sessionChipTitle("Lost")}>
        <TriangleAlert aria-hidden="true" />
        {`Lost${sessionCountSuffix}`}
      </Badge>
    ) : card.tmuxSession != null ? (
      <Badge tone="success" title={sessionChipTitle("Live")}>
        <Activity aria-hidden="true" />
        {`Live${sessionCountSuffix}`}
      </Badge>
    ) : null;

  const hoverOrSelected = hover || selected;
  const identity = needsAttention
    ? "attention"
    : multiSelected
      ? "multi"
      : !elevated && hoverOrSelected
        ? "hover"
        : "rest";
  const surface = elevated
    ? "elevated"
    : pressed
      ? hoverOrSelected
        ? "pressed-hover"
        : "pressed"
      : hoverOrSelected
        ? "hover"
        : "rest";

  return (
    <Card
      ref={rootRef}
      {...domProps}
      aria-label={
        selectable
          ? multiSelected
            ? "Selected for group"
            : "Not selected for group"
          : undefined
      }
      className={cn(
        cardVariants({
          identity,
          surface,
          density: compact ? "compact" : "default",
          dimmed,
        }),
        "relative cursor-pointer touch-manipulation gap-(--space-xs) transition-[background-color,border-color,color,box-shadow] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
      )}
    >
      {multiSelected && (
        <span
          aria-hidden="true"
          className="absolute top-(--space-xs) left-(--space-xs) flex size-3.5 items-center justify-center rounded-full bg-(--text)"
        >
          <Check
            className="size-2.5 text-(--bg)"
            strokeWidth={2.5}
            aria-hidden="true"
          />
        </span>
      )}

      {showDot && (
        <span
          title="Unseen agent activity"
          className="absolute top-(--space-xs) right-(--space-xs) size-1.5 rounded-full bg-(--text-muted)"
        />
      )}

      <div className="flex items-center justify-between gap-(--space-xs)">
        <div className="flex min-w-0 items-center gap-(--space-xs)">
          {priorityDot && (
            <Badge
              title={priorityDot.label}
              stateColor={priorityDot.color}
              className="size-1.5 rounded-full border-0 bg-(--badge-state) p-0"
            />
          )}
          <span className="font-mono text-xs leading-(--line-label) font-semibold whitespace-nowrap text-muted-foreground">
            {card.identifier}
          </span>
        </div>
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-(--space-xs)">
          <SourceBadge source={card.source ?? "linear"} />
          <LinearStateChip card={card} />
          {!isGroup &&
            prs
              .slice(0, PR_CHIP_CAP)
              .map((pr) => (
                <PrBadge key={pr.url} pr={pr} showRepo={showRepo} />
              ))}
          {!isGroup && prs.length > PR_CHIP_CAP && (
            <PrOverflowChip hidden={prs.length - PR_CHIP_CAP} />
          )}
          {card.previews?.map((preview) => (
            <PreviewBadge key={preview.port} preview={preview} />
          ))}
          {card.previewsUnknown != null && (
            <UnknownProbeBadge
              signal="preview"
              category={card.previewsUnknown.category}
              partial={(card.previews?.length ?? 0) > 0}
            />
          )}
          {isGroup && (
            <Badge tone="neutral">
              {memberCount === 1 ? "1 ticket" : `${memberCount} tickets`}
            </Badge>
          )}
          {showGone && <GoneBadge />}
          {isGroup && (
            <Button
              variant="ghost"
              size="icon-md"
              aria-expanded={expanded ?? false}
              aria-label={expanded ? "Hide members" : "Show members"}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onToggleExpand?.();
              }}
            >
              {expanded ? (
                <ChevronDown className="size-3.5" aria-hidden="true" />
              ) : (
                <ChevronRight className="size-3.5" aria-hidden="true" />
              )}
            </Button>
          )}
        </div>
      </div>

      <div
        className={cn(
          "text-base font-semibold text-foreground",
          compact ? "line-clamp-1" : "line-clamp-2",
        )}
      >
        {card.title}
      </div>

      <GroupPrRow card={card} />

      <div className="flex flex-nowrap items-center gap-(--space-xs)">
        {sessionChip}
        {sessionChip != null && (
          <span className="text-sm text-muted-foreground">·</span>
        )}
        <span className="min-w-0 truncate text-xs text-muted-foreground">
          {formatAge(card.updatedAt, nowMs())}
        </span>
        <TeamCycleText card={card} />
        {isCarousel && onMoveTo && (
          <MoveToPicker
            card={card}
            onSelect={(column) => onMoveTo(card.id, column)}
          />
        )}
      </div>

      {card.syncing === true ? (
        <div className="mt-(--space-xs) text-sm font-semibold text-muted-foreground">
          Syncing to Linear…
        </div>
      ) : startError != null && startErrorCopy != null ? (
        <div className="mt-(--space-xs) flex flex-col gap-(--space-xs)">
          <CardNotice icon>{startErrorCopy.heading}</CardNotice>
          {startErrorCopy.detail != null && (
            <div className="text-sm font-normal text-muted-foreground">
              {startErrorCopy.detail}
            </div>
          )}

          {startError.stderr.trim() !== "" && (
            <div className="line-clamp-3 font-mono text-xs leading-(--line-label) font-normal wrap-break-word whitespace-pre-wrap text-muted-foreground">
              {startError.stderr}
            </div>
          )}

          <div className="flex items-center gap-(--space-sm)">
            <Button
              variant="outline"
              size="sm"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onRetryStart?.(card);
              }}
            >
              <RotateCw className="size-3" aria-hidden="true" />
              Retry
            </Button>
            <Button
              variant="link"
              className={cn(
                "h-auto p-0 text-sm font-normal text-muted-foreground",
                hover ? "underline" : "hover:no-underline",
              )}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onSelect?.(card.id);
              }}
            >
              Details
            </Button>
          </div>
        </div>
      ) : card.provisioningStep != null ? (
        <div className="mt-(--space-xs) text-sm font-semibold text-muted-foreground">
          {card.provisioningStep}
        </div>
      ) : card.sessionLost === true ? (
        <div className="mt-(--space-xs) flex flex-col gap-(--space-xs)">
          <CardNotice icon>Session lost</CardNotice>

          {card.workspacePath ? (
            <div className="flex flex-col gap-(--space-xs)">
              {watchdogFired && (
                <CardNotice>
                  {
                    "Still resuming… the board may be catching up. Try Resume again."
                  }
                </CardNotice>
              )}
              {resumeFailed && <CardNotice>{resumeFailureCopy}</CardNotice>}
              <Button
                size="sm"
                disabled={resuming}
                className="self-start"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  onResume?.();
                }}
              >
                <Play className="size-3" aria-hidden="true" />
                {resuming ? "Resuming…" : "Resume"}
              </Button>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="self-start"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onRestart?.(card);
              }}
            >
              <RotateCw className="size-3" aria-hidden="true" />
              Restart
            </Button>
          )}
        </div>
      ) : card.syncError != null ? (
        <div className="mt-(--space-xs)">
          <CardNotice icon>{card.syncError}</CardNotice>
        </div>
      ) : card.statusReason != null ? (
        <div className={MUTED_LINE_CLASS}>{card.statusReason}</div>
      ) : card.startWarning != null && card.startWarning.trim() !== "" ? (
        <div className={MUTED_LINE_CLASS}>{card.startWarning}</div>
      ) : null}

      {card.linearError != null && (
        <div className="mt-(--space-xs)">
          <CardNotice icon>{card.linearError}</CardNotice>
        </div>
      )}

      {card.cleanupWarning != null && card.cleanupWarning.trim() !== "" && (
        <div className="mt-(--space-xs)">
          <div className={MUTED_LINE_CLASS}>{card.cleanupWarning}</div>
        </div>
      )}

      {card.cleanupBlocked != null && card.cleanupBlocked.length > 0 && (
        <div className="mt-(--space-xs)">
          <CardNotice icon>Uncommitted work: cleanup blocked</CardNotice>
        </div>
      )}

      {card.cleaningUp && (
        <div data-testid="cleaning-up" className="mt-(--space-xs)">
          <CardNotice variant="muted">Cleaning up…</CardNotice>
        </div>
      )}

      {card.cleanupBlocked == null &&
        card.cleanupDueAt != null &&
        !card.cleaningUp && (
          <div className="mt-(--space-xs)">
            <div className={MUTED_LINE_CLASS}>
              <span title={new Date(card.cleanupDueAt).toLocaleString()}>
                {formatCleanupCountdown(card.cleanupDueAt, nowMs())}
              </span>
            </div>
          </div>
        )}

      {isGroup && expanded && (
        <div className="mt-(--space-xs) border-t border-border pt-(--space-xs)">
          {(members ?? []).map((member) => (
            <MemberRow
              key={member.id}
              member={member}
              actionable={true}
              groupPreviews={card.previews}
              groupPreviewsUnknown={card.previewsUnknown}
            />
          ))}
        </div>
      )}
    </Card>
  );
}
