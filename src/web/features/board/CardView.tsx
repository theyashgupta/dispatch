import {
  Activity,
  AlertTriangle,
  ArrowRightLeft,
  Check,
  ChevronDown,
  ChevronRight,
  Play,
  RotateCw,
} from "lucide-react";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import type {
  Card as CardModel,
  Column as ColumnId,
} from "../../../shared/types.js";
import { startCard } from "../../lib/api.js";
import { MoveToPicker } from "./MoveToPicker.js";
import { formatAge, nowMs } from "../../lib/format-age.js";
import { useResumeFeedback } from "../../hooks/useResumeFeedback.js";
import {
  GoneBadge,
  LinearStateBadge,
  PrBadge,
  PreviewBadge,
  SourceBadge,
} from "../badges/index.js";
import { Button } from "../../primitives/Button.js";
import { Field } from "../../primitives/Field.js";
import { IconButton } from "../../primitives/IconButton.js";
import { Notice } from "../../primitives/Notice.js";
import {
  errorCopy,
  needsAttention as getNeedsAttention,
} from "./card-attention.js";
import { MemberRow } from "./MemberRow.js";

export const PRIORITY_DOT: Record<number, { color: string; label: string }> = {
  1: { color: "var(--prio-urgent)", label: "Urgent priority" },
  2: { color: "var(--prio-high)", label: "High priority" },
  3: { color: "var(--prio-medium)", label: "Medium priority" },
  4: { color: "var(--prio-low)", label: "Low priority" },
};

interface CardViewProps {
  card: CardModel;
  selected: boolean;
  multiSelected?: boolean;
  showDot: boolean;
  showGone: boolean;
  hover: boolean;
  elevated?: boolean;
  dimmed?: boolean;
  rootRef?: React.Ref<HTMLDivElement>;
  domProps?: React.HTMLAttributes<HTMLDivElement>;
  onSelect?: (id: string) => void;
  onStartRequest?: (id: string) => void;
  expanded?: boolean;
  onToggleExpand?: () => void;
  members?: CardModel[];
  isCarousel?: boolean;
  onMoveTo?: (cardId: string, targetColumn: ColumnId) => void;
}

export function CardView({
  card,
  selected,
  multiSelected = false,
  showDot,
  showGone,
  hover,
  elevated = false,
  dimmed = false,
  rootRef,
  domProps,
  onSelect,
  onStartRequest,
  expanded,
  onToggleExpand,
  members,
  isCarousel = false,
  onMoveTo,
}: CardViewProps) {
  const [pickerRect, setPickerRect] = useState<DOMRect | null>(null);
  const moveTriggerRef = useRef<HTMLButtonElement | null>(null);

  const [prevCarousel, setPrevCarousel] = useState(isCarousel);
  if (prevCarousel !== isCarousel) {
    setPrevCarousel(isCarousel);
    if (pickerRect != null) setPickerRect(null);
  }
  const { resuming, resumeFailed, watchdogFired, failureCopy, onResume } =
    useResumeFeedback(card);
  const compact = card.column === "done";
  const isGroup = card.source === "group";
  const selectable = card.column === "todo" && card.groupId == null && !isGroup;
  const needsAttention = getNeedsAttention(card);
  const priorityDot = isGroup ? undefined : PRIORITY_DOT[card.priority];
  const memberCount = members?.length ?? 0;
  const chipStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: "var(--space-xs)",
    borderRadius: "var(--radius)",
    padding: "0 var(--space-xs)",
    fontSize: "var(--font-label)",
    fontWeight: "var(--weight-semibold)",
    lineHeight: "var(--line-label)",
    whiteSpace: "nowrap",
    flex: "0 0 auto",
  };
  const sessionChip =
    card.provisioningStep != null ? (
      <span
        style={{
          ...chipStyle,
          border: "1px solid var(--border)",
          color: "var(--text-muted)",
        }}
      >
        <RotateCw size={12} strokeWidth={2} aria-hidden="true" />
        Provisioning
      </span>
    ) : card.sessionLost === true ? (
      <span
        style={{
          ...chipStyle,
          background:
            "color-mix(in srgb, var(--destructive) 16%, var(--surface-card))",
          color: "var(--destructive)",
        }}
      >
        <AlertTriangle size={12} strokeWidth={2} aria-hidden="true" />
        Lost
      </span>
    ) : card.tmuxSession != null ? (
      <span
        style={{
          ...chipStyle,
          background:
            "color-mix(in srgb, var(--status-ok) 16%, var(--surface-card))",
          color: "var(--status-ok)",
        }}
      >
        <Activity size={12} strokeWidth={2} aria-hidden="true" />
        Live
      </span>
    ) : null;

  const hoverOrSelected = hover || selected;
  const border =
    needsAttention || multiSelected
      ? "1px solid var(--accent)"
      : !elevated && hoverOrSelected
        ? "1px solid var(--text-muted)"
        : "1px solid var(--border)";
  const background = elevated
    ? "var(--surface-card)"
    : hoverOrSelected
      ? "var(--surface-card-hover)"
      : "var(--surface-card)";
  const boxShadowParts: string[] = [];
  if (needsAttention || multiSelected) {
    boxShadowParts.push("0 0 0 1px var(--accent)");
  }
  if (elevated) boxShadowParts.push("0 6px 16px rgba(0,0,0,0.45)");
  if (hover && !elevated && !selected && !needsAttention) {
    boxShadowParts.push("0 2px 8px rgba(0,0,0,0.3)");
  }
  const boxShadow =
    boxShadowParts.length > 0 ? boxShadowParts.join(", ") : "none";

  return (
    <>
      <div
        ref={rootRef}
        {...domProps}
        aria-label={
          selectable
            ? multiSelected
              ? "Selected for group"
              : "Not selected for group"
            : undefined
        }
        style={{
          position: "relative",
          background,
          border,
          borderRadius: "var(--radius)",
          padding: compact
            ? "var(--space-xs)"
            : "var(--space-xs) var(--space-sm)",
          cursor: "pointer",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-xs)",
          opacity: dimmed ? 0.4 : 1,
          boxShadow,
          touchAction: "manipulation",
        }}
      >
        {multiSelected && (
          <span
            aria-hidden="true"
            style={{
              position: "absolute",
              top: "var(--space-xs)",
              left: "var(--space-xs)",
              width: "14px",
              height: "14px",
              borderRadius: "50%",
              background: "var(--accent)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Check
              size={10}
              strokeWidth={2.5}
              aria-hidden="true"
              style={{ color: "var(--text)" }}
            />
          </span>
        )}

        {showDot && (
          <span
            title="Unseen agent activity"
            style={{
              position: "absolute",
              top: "var(--space-xs)",
              right: "var(--space-xs)",
              width: "6px",
              height: "6px",
              borderRadius: "50%",
              background: "var(--text-muted)",
            }}
          />
        )}

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "var(--space-xs)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-xs)",
              minWidth: 0,
            }}
          >
            {priorityDot && (
              <span
                title={priorityDot.label}
                style={{
                  width: "6px",
                  height: "6px",
                  borderRadius: "50%",
                  background: priorityDot.color,
                  flex: "0 0 auto",
                }}
              />
            )}
            <Field mono>{card.identifier}</Field>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-xs)",
              flexWrap: "wrap",
              justifyContent: "flex-end",
            }}
          >
            <SourceBadge source={card.source ?? "linear"} />
            <LinearStateBadge card={card} />
            {card.prs?.map((pr) => (
              <PrBadge key={pr.url} pr={pr} />
            ))}
            {card.previews?.map((preview) => (
              <PreviewBadge key={preview.port} preview={preview} />
            ))}
            {isGroup && (
              <span
                style={{
                  ...chipStyle,
                  border: "1px solid var(--border)",
                  color: "var(--text-muted)",
                }}
              >
                {memberCount === 1 ? "1 ticket" : `${memberCount} tickets`}
              </span>
            )}
            {showGone && <GoneBadge />}
            {isGroup && (
              <IconButton
                aria-expanded={expanded ?? false}
                aria-label={expanded ? "Hide members" : "Show members"}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleExpand?.();
                }}
              >
                {expanded ? (
                  <ChevronDown size={14} strokeWidth={2} aria-hidden="true" />
                ) : (
                  <ChevronRight size={14} strokeWidth={2} aria-hidden="true" />
                )}
              </IconButton>
            )}
          </div>
        </div>

        <div
          style={{
            fontSize: "var(--font-body)",
            fontWeight: "var(--weight-semibold)",
            lineHeight: "var(--line-body)",
            color: "var(--text)",
            display: "-webkit-box",
            WebkitBoxOrient: "vertical",
            WebkitLineClamp: compact ? 1 : 2,
            overflow: "hidden",
          }}
        >
          {card.title}
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-xs)",
            flexWrap: "nowrap",
          }}
        >
          {sessionChip}
          {sessionChip != null && (
            <span
              style={{
                fontSize: "var(--font-label)",
                lineHeight: "var(--line-label)",
                color: "var(--text-muted)",
              }}
            >
              ·
            </span>
          )}
          <span
            style={{
              fontSize: "var(--font-label)",
              lineHeight: "var(--line-label)",
              color: "var(--text-muted)",
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {formatAge(card.updatedAt, nowMs())}
          </span>
          {isCarousel && onMoveTo && (
            <Button
              variant="secondary"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                setPickerRect(e.currentTarget.getBoundingClientRect());
              }}
              ref={moveTriggerRef}
              aria-expanded={pickerRect != null}
              style={{
                marginLeft: "auto",
                flex: "0 0 auto",
                height: "44px",
              }}
            >
              <ArrowRightLeft size={12} strokeWidth={2} aria-hidden="true" />
              Move to…
            </Button>
          )}
        </div>

        {card.syncing === true ? (
          <div
            style={{
              marginTop: "var(--space-xs)",
              fontSize: "var(--font-label)",
              fontWeight: "var(--weight-semibold)",
              lineHeight: "var(--line-label)",
              color: "var(--text-muted)",
            }}
          >
            Syncing to Linear…
          </div>
        ) : card.startError != null ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-xs)",
              marginTop: "var(--space-xs)",
            }}
          >
            {(() => {
              const { heading, detail } = errorCopy(
                card.startError,
                card.identifier,
              );
              return (
                <>
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
                    label={heading}
                  />
                  {detail != null && (
                    <div
                      style={{
                        fontSize: "var(--font-label)",
                        fontWeight: "var(--weight-regular)",
                        lineHeight: "var(--line-label)",
                        color: "var(--text-muted)",
                      }}
                    >
                      {detail}
                    </div>
                  )}
                </>
              );
            })()}

            {card.startError.stderr.trim() !== "" && (
              <Notice tone="destructive" mono clamp>
                {card.startError.stderr}
              </Notice>
            )}

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--space-sm)",
              }}
            >
              <Button
                variant="secondary"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  startCard(card.id, card.extraDirection ?? "").catch((err) => {
                    console.error("retry startCard failed", err);
                  });
                }}
              >
                <RotateCw size={12} strokeWidth={2} aria-hidden="true" />
                Retry
              </Button>
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect?.(card.id);
                }}
                style={{
                  padding: 0,
                  background: "transparent",
                  border: "none",
                  color: "var(--text-muted)",
                  fontSize: "var(--font-label)",
                  fontWeight: "var(--weight-regular)",
                  lineHeight: "var(--line-label)",
                  textDecoration: hover ? "underline" : "none",
                  cursor: "pointer",
                }}
              >
                Details
              </button>
            </div>
          </div>
        ) : card.provisioningStep != null ? (
          <div
            style={{
              marginTop: "var(--space-xs)",
              fontSize: "var(--font-label)",
              fontWeight: "var(--weight-semibold)",
              lineHeight: "var(--line-label)",
              color: "var(--text-muted)",
            }}
          >
            {card.provisioningStep}
          </div>
        ) : card.sessionLost === true && card.column !== "done" ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-xs)",
              marginTop: "var(--space-xs)",
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

            {card.column === "in_review" && card.workspacePath ? (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "var(--space-xs)",
                }}
              >
                {watchdogFired && (
                  <Notice
                    tone="destructive"
                    label="Still resuming… the board may be catching up. Try Resume again."
                  />
                )}
                {resumeFailed && (
                  <Notice tone="destructive" label={failureCopy} />
                )}
                <Button
                  variant="primary"
                  disabled={resuming}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    onResume();
                  }}
                  style={{ alignSelf: "flex-start" }}
                >
                  <Play size={12} strokeWidth={2} aria-hidden="true" />
                  {resuming ? "Resuming…" : "Resume"}
                </Button>
              </div>
            ) : (
              <Button
                variant="secondary"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  if (card.workspace) {
                    startCard(card.id, card.extraDirection ?? "").catch(
                      (err) => {
                        console.error("restart startCard failed", err);
                      },
                    );
                  } else {
                    onStartRequest?.(card.id);
                  }
                }}
                style={{ alignSelf: "flex-start" }}
              >
                <RotateCw size={12} strokeWidth={2} aria-hidden="true" />
                Restart
              </Button>
            )}
          </div>
        ) : card.syncError != null ? (
          <div style={{ marginTop: "var(--space-xs)" }}>
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
              label={card.syncError}
            />
          </div>
        ) : card.statusReason != null ? (
          <Notice tone="muted">{card.statusReason}</Notice>
        ) : card.startWarning != null && card.startWarning.trim() !== "" ? (
          <Notice tone="muted">{card.startWarning}</Notice>
        ) : null}

        {card.cleanupWarning != null && card.cleanupWarning.trim() !== "" && (
          <div style={{ marginTop: "var(--space-xs)" }}>
            <Notice tone="muted">{card.cleanupWarning}</Notice>
          </div>
        )}

        {card.cleanupBlocked != null && card.cleanupBlocked.length > 0 && (
          <div style={{ marginTop: "var(--space-xs)" }}>
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
              label="Uncommitted work — cleanup blocked"
            />
          </div>
        )}

        {isGroup && expanded && (
          <div
            style={{
              borderTop: "1px solid var(--border)",
              marginTop: "var(--space-xs)",
              paddingTop: "var(--space-xs)",
            }}
          >
            {(members ?? []).map((member) => (
              <MemberRow key={member.id} member={member} groupPr={card.prs} />
            ))}
          </div>
        )}
      </div>
      {isCarousel &&
        pickerRect != null &&
        onMoveTo != null &&
        createPortal(
          <MoveToPicker
            card={card}
            anchorRect={pickerRect}
            onSelect={(column) => onMoveTo(card.id, column)}
            onClose={() => {
              setPickerRect(null);
              moveTriggerRef.current?.focus();
            }}
          />,
          document.body,
        )}
    </>
  );
}
