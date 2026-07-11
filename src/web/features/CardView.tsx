import { Activity, AlertTriangle, Play, RotateCw } from "lucide-react";
import type { Card as CardModel } from "../../shared/types.js";
import { startCard } from "../lib/api.js";
import { formatAge, nowMs } from "../lib/format-age.js";
import { useResumeFeedback } from "../hooks/useResumeFeedback.js";
import { GoneBadge } from "./badges/GoneBadge.js";
import { PlanReadyBadge } from "./badges/PlanReadyBadge.js";
import { SourceBadge } from "./badges/SourceBadge.js";
import { Button } from "../primitives/Button.js";
import { Field } from "../primitives/Field.js";
import { Notice } from "../primitives/Notice.js";

const PRIORITY_STRIPE: Record<number, string> = {
  1: "var(--prio-urgent)",
  2: "var(--prio-high)",
  3: "var(--prio-medium)",
  4: "var(--prio-low)",
};

interface CardViewProps {
  card: CardModel;
  selected: boolean;
  showDot: boolean;
  showGone: boolean;
  hover: boolean;
  elevated?: boolean;
  dimmed?: boolean;
  rootRef?: React.Ref<HTMLDivElement>;
  domProps?: React.HTMLAttributes<HTMLDivElement>;
  onSelect?: (id: string) => void;
  onStartRequest?: (id: string) => void;
}

function errorCopy(card: CardModel): { heading: string; detail?: string } {
  const err = card.startError!;
  switch (err.variant) {
    case "branch-conflict":
      return {
        heading: "Start failed — branch checked out elsewhere",
        detail: `Branch ${card.identifier} is attached to another worktree.`,
      };
    case "repl-timeout":
      return { heading: "Start failed — Claude didn't start" };
    default:
      return { heading: `Start failed — ${err.step}` };
  }
}

export function CardView({
  card,
  selected,
  showDot,
  showGone,
  hover,
  elevated = false,
  dimmed = false,
  rootRef,
  domProps,
  onSelect,
  onStartRequest,
}: CardViewProps) {
  const { resuming, resumeFailed, watchdogFired, failureCopy, onResume } =
    useResumeFeedback(card);
  const compact = card.column === "done";
  const stripe = PRIORITY_STRIPE[card.priority];
  const sessionGlyph =
    card.provisioningStep != null ? (
      <RotateCw
        size={12}
        strokeWidth={2}
        aria-hidden="true"
        style={{ color: "var(--text-muted)", flex: "0 0 auto" }}
      />
    ) : card.sessionLost === true ? (
      <AlertTriangle
        size={12}
        strokeWidth={2}
        aria-hidden="true"
        style={{ color: "var(--destructive)", flex: "0 0 auto" }}
      />
    ) : card.tmuxSession != null ? (
      <Activity
        size={12}
        strokeWidth={2}
        aria-hidden="true"
        style={{ color: "var(--status-ok)", flex: "0 0 auto" }}
      />
    ) : null;

  return (
    <div
      ref={rootRef}
      {...domProps}
      style={{
        position: "relative",
        background: hover ? "var(--surface-card-hover)" : "var(--surface-card)",
        border: "1px solid var(--border)",
        borderLeft: stripe
          ? `var(--stripe-width) solid ${stripe}`
          : "1px solid var(--border)",
        borderRadius: "var(--radius)",
        padding: compact ? "var(--space-xs)" : "var(--space-sm)",
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-xs)",
        opacity: dimmed ? 0.4 : 1,
        boxShadow: elevated
          ? "0 0 0 1px var(--accent), 0 6px 16px rgba(0,0,0,0.45)"
          : selected
            ? "0 0 0 1px var(--accent)"
            : "none",
        touchAction: "manipulation",
      }}
    >
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
          <Field mono>{card.identifier}</Field>
          {sessionGlyph}
          <span
            style={{
              fontSize: "var(--font-label)",
              lineHeight: "var(--line-label)",
              color: "var(--text-muted)",
            }}
          >
            ·
          </span>
          <span
            style={{
              fontSize: "var(--font-label)",
              lineHeight: "var(--line-label)",
              color: "var(--text-muted)",
            }}
          >
            {formatAge(card.updatedAt, nowMs())}
          </span>
        </div>
        <div style={{ display: "flex", gap: "var(--space-xs)" }}>
          <SourceBadge source={card.source ?? "linear"} />
          {card.planReady && <PlanReadyBadge />}
          {showGone && <GoneBadge />}
        </div>
      </div>

      <div
        style={{
          fontSize: "var(--font-body)",
          fontWeight: "var(--weight-regular)",
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

      {card.startError != null ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-xs)",
            marginTop: "var(--space-xs)",
          }}
        >
          {(() => {
            const { heading, detail } = errorCopy(card);
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

          {(card.column === "in_review" || card.column === "in_planning") &&
          card.workspacePath ? (
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
                  startCard(card.id, card.extraDirection ?? "").catch((err) => {
                    console.error("restart startCard failed", err);
                  });
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
      ) : card.statusReason != null ? (
        <Notice tone="muted">{card.statusReason}</Notice>
      ) : card.startWarning != null && card.startWarning.trim() !== "" ? (
        <Notice tone="muted">{card.startWarning}</Notice>
      ) : null}

      {card.cleanupWarning != null && card.cleanupWarning.trim() !== "" && (
        <Notice tone="muted">{card.cleanupWarning}</Notice>
      )}
    </div>
  );
}
