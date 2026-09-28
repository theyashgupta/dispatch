import { useEffect, useState, type CSSProperties } from "react";
import type { SentryFrame, SentryIssueDetail } from "../../../shared/types.js";
import { sentryFixPrompt } from "../../lib/agent-prompt.js";
import {
  getSentryIssue,
  promoteItem,
  resolveSentryIssue,
  snoozeItem,
} from "../../lib/api.js";
import { formatAge, nowMs } from "../../lib/format-age.js";
import {
  exceptionLine,
  frameLabel,
  sentryContext,
} from "../../lib/sentry-context.js";
import {
  SNOOZE_LABELS,
  SNOOZE_PRESETS,
  snoozeUntil,
  type SnoozePreset,
} from "../../lib/snooze.js";
import { Button } from "../../primitives/Button.js";
import { Chip } from "../../primitives/Chip.js";
import { Collapsible } from "../../primitives/Collapsible.js";
import {
  DetailActions,
  DetailHeader,
  DetailPlaceholder,
  DetailScroll,
} from "../../primitives/DetailPaneBody.js";
import { Notice } from "../../primitives/Notice.js";
import { Spinner } from "../../primitives/Spinner.js";
import { levelTone, type ErrorRow } from "./error-rows.js";

interface ErrorDetailProps {
  row: ErrorRow | null;
  placeholder: string | null;
  onBack?: () => void;
  onStartAgent: (row: ErrorRow, prompt: string, context: string) => void;
  onNotice: (text: string) => void;
}

interface FrameCodeProps {
  frame: SentryFrame;
}

type Load =
  | { kind: "loading" }
  | { kind: "ok"; detail: SentryIssueDetail }
  | { kind: "error"; message: string };

const ERROR_COPY: Record<string, string> = {
  rejected: "Sentry rejected the token. Reconnect Sentry in Settings.",
  forbidden:
    "Sentry refused this action. Check that the token has the event:write scope.",
  "no-credential": "Sentry is not connected. Connect it in Settings.",
  "not-found": "Sentry could not find this issue.",
  "unknown item": "This error is no longer listed.",
  "rate-limited": "Sentry's rate limit was reached. Try again in a minute.",
  unreachable: "Couldn't reach Sentry. Check your connection and try again.",
};

const monoStyle: CSSProperties = {
  flex: "0 0 auto",
  margin: 0,
  padding: "var(--space-sm)",
  overflowX: "auto",
  background: "var(--surface-column)",
  borderRadius: "var(--radius)",
  fontFamily: "var(--font-mono)",
  fontSize: "var(--font-micro)",
  lineHeight: "var(--line-label)",
  color: "var(--text)",
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
};

const exceptionStyle: CSSProperties = {
  ...monoStyle,
  fontSize: "var(--font-label)",
  borderLeft: "2px solid var(--destructive)",
};

const listLineStyle: CSSProperties = {
  display: "flex",
  gap: "var(--space-sm)",
  padding: "var(--space-xs) 0",
  fontSize: "var(--font-label)",
  lineHeight: "var(--line-label)",
  color: "var(--text)",
  minWidth: 0,
  overflowWrap: "anywhere",
};

const mutedStyle: CSSProperties = {
  color: "var(--text-muted)",
  flex: "0 0 auto",
};

const tagsStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "var(--space-xs)",
};

const errorLineStyle: CSSProperties = {
  background:
    "color-mix(in srgb, var(--destructive) 16%, var(--surface-column))",
  fontWeight: "var(--weight-semibold)",
};

function relative(iso: string | null): string {
  return iso ? formatAge(iso, nowMs()) : "unknown";
}

function failureText(error: string): string {
  return ERROR_COPY[error] ?? ERROR_COPY.unreachable;
}

function FrameCode({ frame }: FrameCodeProps) {
  if (frame.context.length === 0) {
    return <div style={mutedStyle}>No source lines for this frame.</div>;
  }
  return (
    <pre style={monoStyle}>
      {frame.context.map((c) => (
        <div
          key={c.line}
          style={c.line === frame.line ? errorLineStyle : undefined}
          data-error-line={c.line === frame.line ? "true" : undefined}
        >
          {`${String(c.line).padStart(4, " ")}  ${c.code}`}
        </div>
      ))}
    </pre>
  );
}

export function ErrorDetail({
  row,
  placeholder,
  onBack,
  onStartAgent,
  onNotice,
}: ErrorDetailProps) {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const issueId = row?.issueId;

  useEffect(() => {
    if (issueId === undefined) return;
    let live = true;
    void getSentryIssue(issueId).then((result) => {
      if (!live) return;
      setLoad(
        result.ok
          ? { kind: "ok", detail: result.detail }
          : { kind: "error", message: failureText(result.error) },
      );
    });
    return () => {
      live = false;
    };
  }, [issueId]);

  if (!row) {
    return (
      <DetailScroll>
        {placeholder && <DetailPlaceholder>{placeholder}</DetailPlaceholder>}
      </DetailScroll>
    );
  }

  const detail = load.kind === "ok" ? load.detail : null;
  const inApp = detail?.frames.filter((f) => f.inApp) ?? [];
  const other = detail?.frames.filter((f) => !f.inApp) ?? [];
  const current = row;

  async function handleCreateTicket(context: string) {
    setBusy("ticket");
    setError(null);
    try {
      const { card } = await promoteItem(current.itemId, context);
      onNotice(`Created ${card.identifier}`);
    } catch {
      setError("Couldn't create the ticket. Try again.");
    } finally {
      setBusy(null);
    }
  }

  async function handleResolve() {
    setBusy("resolve");
    setError(null);
    const result = await resolveSentryIssue(current.issueId);
    setBusy(null);
    if (!result.ok) {
      setError(failureText(result.error));
      return;
    }
    onNotice("Resolved in Sentry");
  }

  async function handleSnooze(preset: SnoozePreset) {
    setBusy("snooze");
    setError(null);
    try {
      await snoozeItem(
        current.itemId,
        snoozeUntil(preset, new Date()).toISOString(),
      );
      setSnoozeOpen(false);
      onNotice(
        `${current.shortId || current.title} snoozed for ${SNOOZE_LABELS[preset]}`,
      );
    } catch {
      setError("Couldn't snooze this error. Try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <DetailScroll testId="error-detail">
      <DetailHeader
        onBack={onBack}
        title={row.shortId ? `${row.shortId} ${row.title}` : row.title}
      >
        <Chip tone={levelTone(row.level)}>{row.level || "unknown"}</Chip>
        {row.project && <Chip>{row.project}</Chip>}
        {detail && (
          <span data-testid="error-impact">
            {detail.count} events, {detail.userCount} users, first seen{" "}
            {relative(detail.firstSeen)}, last seen {relative(detail.lastSeen)}
          </span>
        )}
      </DetailHeader>
      {load.kind === "loading" && <Spinner />}
      {load.kind === "error" && (
        <Notice tone="destructive" label={load.message} />
      )}
      <DetailActions>
        <Button
          variant="primary"
          disabled={busy !== null || !detail}
          onClick={() =>
            detail &&
            onStartAgent(row, sentryFixPrompt(detail), sentryContext(detail))
          }
        >
          Fix with agent
        </Button>
        <Button
          variant="secondary"
          disabled={busy !== null || !detail}
          loading={busy === "ticket"}
          onClick={() =>
            detail && void handleCreateTicket(sentryContext(detail))
          }
        >
          Create ticket
        </Button>
        <Button
          variant="secondary"
          disabled={busy !== null}
          loading={busy === "resolve"}
          onClick={() => void handleResolve()}
        >
          Resolve in Sentry
        </Button>
        <Button
          variant="secondary"
          disabled={busy !== null}
          aria-expanded={snoozeOpen}
          onClick={() => setSnoozeOpen((open) => !open)}
        >
          Snooze
        </Button>
        {row.url && (
          <Button
            variant="secondary"
            onClick={() => window.open(row.url, "_blank", "noopener")}
          >
            Open in Sentry
          </Button>
        )}
      </DetailActions>
      {snoozeOpen && (
        <DetailActions>
          {SNOOZE_PRESETS.map((preset) => (
            <Button
              key={preset}
              variant="secondary"
              disabled={busy !== null}
              onClick={() => void handleSnooze(preset)}
            >
              {SNOOZE_LABELS[preset]}
            </Button>
          ))}
        </DetailActions>
      )}
      {error && <Notice tone="destructive" label={error} />}
      {detail && (
        <>
          <pre style={exceptionStyle} data-testid="error-exception">
            {exceptionLine(detail)}
            {detail.culprit ? `\n${detail.culprit}` : ""}
          </pre>
          <Collapsible
            title="Breadcrumbs"
            badge={<Chip>{detail.breadcrumbs.length}</Chip>}
            defaultOpen
          >
            {detail.breadcrumbs.length === 0 ? (
              <div style={mutedStyle}>No breadcrumbs</div>
            ) : (
              detail.breadcrumbs.map((b, index) => (
                <div key={index} style={listLineStyle}>
                  <span style={mutedStyle}>
                    {[b.timestamp ? relative(b.timestamp) : null, b.category]
                      .filter(Boolean)
                      .join(" ")}
                  </span>
                  <span>{b.message ?? ""}</span>
                </div>
              ))
            )}
          </Collapsible>
          <Collapsible
            title="Stack trace"
            badge={<Chip>{detail.frames.length}</Chip>}
            defaultOpen
          >
            {inApp.map((frame, index) => (
              <Collapsible key={`in-${index}`} title={frameLabel(frame)}>
                <FrameCode frame={frame} />
              </Collapsible>
            ))}
            {other.length > 0 && (
              <Collapsible title={`Other frames (${other.length})`}>
                {other.map((frame, index) => (
                  <div key={`other-${index}`} style={listLineStyle}>
                    {frameLabel(frame)}
                  </div>
                ))}
              </Collapsible>
            )}
            {detail.frames.length === 0 && (
              <div style={mutedStyle}>No stack trace</div>
            )}
          </Collapsible>
          {detail.tags.length > 0 && (
            <div style={tagsStyle} data-testid="error-tags">
              {detail.tags.map((tag) => (
                <Chip key={`${tag.key}=${tag.value}`}>
                  {tag.key}={tag.value}
                </Chip>
              ))}
            </div>
          )}
        </>
      )}
    </DetailScroll>
  );
}
