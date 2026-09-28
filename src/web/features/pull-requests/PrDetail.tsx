import {
  useCallback,
  useEffect,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import type {
  PrCheckState,
  PrDetail as PrDetailModel,
  PrReviewEvent,
} from "../../../shared/types.js";
import { fixCiPrompt, reviewPrompt } from "../../lib/agent-prompt.js";
import {
  getPullRequest,
  mergePullRequest,
  reviewPullRequest,
} from "../../lib/api.js";
import { withSsoUrl } from "../../lib/connection-status.js";
import type { PrRow } from "../../lib/pr-rows.js";
import { Button } from "../../primitives/Button.js";
import { Chip } from "../../primitives/Chip.js";
import { Collapsible } from "../../primitives/Collapsible.js";
import { Markdown } from "../../primitives/Markdown.js";
import { Notice } from "../../primitives/Notice.js";
import { Spinner } from "../../primitives/Spinner.js";
import { focusRing } from "../../primitives/focus-ring.js";
import {
  DetailActions,
  DetailHeader,
  DetailPlaceholder,
  DetailScroll,
} from "../../primitives/DetailPaneBody.js";
import { MergeConfirmModal } from "./MergeConfirmModal.js";

interface PrDetailProps {
  row: PrRow | null;
  onBack?: () => void;
  onStartAgent: (row: PrRow, prompt: string) => void;
  onNotice: (text: string) => void;
}

type Load =
  | { kind: "loading" }
  | { kind: "ok"; detail: PrDetailModel }
  | { kind: "error"; message: string };

type Composer = "REQUEST_CHANGES" | "COMMENT" | null;

interface ExternalTextLinkProps {
  href: string;
  children: ReactNode;
}

const ERROR_COPY: Record<string, string> = {
  rejected: "GitHub rejected the token. Reconnect GitHub in Settings.",
  "no-credential": "GitHub is not connected. Connect it in Settings.",
  "not-found": "GitHub could not find this pull request.",
  "sso-required":
    "GitHub needs you to authorize the token for this organization's SAML single sign-on.",
  "rate-limited": "GitHub's rate limit was reached. Try again in a minute.",
  unreachable: "Couldn't reach GitHub. Check your connection and try again.",
  "not-mergeable": "GitHub will not merge this pull request.",
  refused: "GitHub refused the review.",
  "invalid review": "Write a comment before sending.",
};

const CHECK_TONE: Record<PrCheckState, "danger" | "warning" | "success"> = {
  fail: "danger",
  pending: "warning",
  pass: "success",
};

const CHECK_LABEL: Record<PrCheckState, string> = {
  fail: "Failing",
  pending: "Pending",
  pass: "Passing",
};

const linkStyle: CSSProperties = {
  color: "var(--text)",
  textDecoration: "underline",
};

const composerStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-sm)",
};

const textareaStyle: CSSProperties = {
  minHeight: "96px",
  padding: "var(--space-sm)",
  background: "var(--surface-column)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius)",
  color: "var(--text)",
  fontFamily: "var(--font-ui)",
  fontSize: "var(--font-body)",
  lineHeight: "var(--line-body)",
  resize: "vertical",
};

const checkRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-sm)",
  padding: "var(--space-xs) 0",
  fontSize: "var(--font-label)",
  lineHeight: "var(--line-label)",
  color: "var(--text)",
  minWidth: 0,
};

const patchStyle: CSSProperties = {
  margin: 0,
  padding: "var(--space-sm)",
  overflowX: "auto",
  background: "var(--surface-column)",
  borderRadius: "var(--radius)",
  fontFamily: "var(--font-mono)",
  fontSize: "var(--font-micro)",
  lineHeight: "var(--line-label)",
};

function lineColor(line: string): string {
  if (line.startsWith("+")) return "var(--status-ok)";
  if (line.startsWith("-")) return "var(--destructive-text)";
  if (line.startsWith("@@")) return "var(--text-muted)";
  return "var(--text)";
}

function ExternalTextLink({ href, children }: ExternalTextLinkProps) {
  const [focused, setFocused] = useState(false);
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onFocus={(event) =>
        setFocused(event.currentTarget.matches(":focus-visible"))
      }
      onBlur={() => setFocused(false)}
      style={{ ...linkStyle, ...focusRing(focused) }}
    >
      {children}
    </a>
  );
}

function failureText(error: string, message?: string, ssoUrl?: string): string {
  const base = ERROR_COPY[error] ?? ERROR_COPY.unreachable;
  if (ssoUrl) return withSsoUrl(base, ssoUrl);
  return message ? `${base} GitHub said: ${message}` : base;
}

export function PrDetail({
  row,
  onBack,
  onStartAgent,
  onNotice,
}: PrDetailProps) {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [composer, setComposer] = useState<Composer>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmMerge, setConfirmMerge] = useState(false);
  const [composerFocus, setComposerFocus] = useState(false);

  const owner = row?.owner;
  const name = row?.name;
  const number = row?.number;

  const refresh = useCallback(async () => {
    if (owner === undefined || name === undefined || number === undefined) {
      return;
    }
    const result = await getPullRequest(owner, name, number);
    setLoad(
      result.ok
        ? { kind: "ok", detail: result.detail }
        : {
            kind: "error",
            message: failureText(result.error, result.message, result.ssoUrl),
          },
    );
  }, [owner, name, number]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const label = row ? `${row.repo}#${row.number}` : "";

  async function handleReview(event: PrReviewEvent, body?: string) {
    if (!row) return;
    setBusy(event);
    setError(null);
    const result = await reviewPullRequest(
      row.owner,
      row.name,
      row.number,
      event,
      body,
    );
    setBusy(null);
    if (!result.ok) {
      setError(failureText(result.error, result.message, result.ssoUrl));
      return;
    }
    setComposer(null);
    setDraft("");
    onNotice(
      event === "APPROVE"
        ? `Approved ${label}.`
        : event === "REQUEST_CHANGES"
          ? `Requested changes on ${label}.`
          : `Commented on ${label}.`,
    );
  }

  async function handleMerge(detail: PrDetailModel) {
    if (!row) return;
    setBusy("MERGE");
    setError(null);
    const result = await mergePullRequest(
      row.owner,
      row.name,
      row.number,
      detail.headSha,
    );
    setBusy(null);
    if (!result.ok) {
      setError(failureText(result.error, result.message, result.ssoUrl));
      await refresh();
      return;
    }
    onNotice(`Merged ${label}.`);
    await refresh();
  }

  if (!row) {
    return (
      <DetailScroll>
        <DetailPlaceholder>
          Select a pull request to see its detail.
        </DetailPlaceholder>
      </DetailScroll>
    );
  }

  const detail = load.kind === "ok" ? load.detail : null;
  const failing = detail?.checks.some((c) => c.state === "fail") ?? false;
  const open = detail?.state === "open";

  return (
    <DetailScroll testId="pr-detail">
      <DetailHeader onBack={onBack} title={row.title}>
        <ExternalTextLink href={row.url}>{label}</ExternalTextLink>
        {detail && (
          <>
            <span>{detail.author}</span>
            <span>
              {detail.head} into {detail.base}
            </span>
            <span>
              +{detail.additions} -{detail.deletions}
            </span>
            <Chip
              tone={
                detail.state === "merged"
                  ? "success"
                  : detail.state === "closed"
                    ? "danger"
                    : "neutral"
              }
            >
              {detail.state === "merged"
                ? "Merged"
                : detail.state === "closed"
                  ? "Closed"
                  : detail.draft
                    ? "Draft"
                    : "Open"}
            </Chip>
          </>
        )}
      </DetailHeader>
      {load.kind === "loading" && <Spinner />}
      {load.kind === "error" && (
        <Notice tone="destructive" label={load.message} />
      )}
      {detail && (
        <>
          <DetailActions>
            <Button
              variant="secondary"
              disabled={!open || busy !== null}
              loading={busy === "APPROVE"}
              onClick={() => void handleReview("APPROVE")}
            >
              Approve
            </Button>
            <Button
              variant="secondary"
              disabled={!open || busy !== null}
              aria-pressed={composer === "REQUEST_CHANGES"}
              onClick={() => setComposer("REQUEST_CHANGES")}
            >
              Request changes
            </Button>
            <Button
              variant="secondary"
              disabled={!open || busy !== null}
              aria-pressed={composer === "COMMENT"}
              onClick={() => setComposer("COMMENT")}
            >
              Comment
            </Button>
            <Button
              variant="primary"
              disabled={!open || busy !== null}
              onClick={() => setConfirmMerge(true)}
            >
              Squash merge
            </Button>
            <Button
              variant="secondary"
              onClick={() =>
                onStartAgent(row, reviewPrompt(detail, row.repo, row.number))
              }
            >
              Review with agent
            </Button>
            <Button
              variant="secondary"
              disabled={!failing}
              onClick={() =>
                onStartAgent(row, fixCiPrompt(detail, row.repo, row.number))
              }
            >
              Fix CI with agent
            </Button>
            <Button
              variant="secondary"
              onClick={() => window.open(row.url, "_blank", "noopener")}
            >
              Open on GitHub
            </Button>
          </DetailActions>
          {composer && (
            <div style={composerStyle}>
              <textarea
                aria-label={
                  composer === "COMMENT" ? "Comment" : "Requested changes"
                }
                value={draft}
                maxLength={20000}
                onChange={(event) => setDraft(event.target.value)}
                onFocus={(event) =>
                  setComposerFocus(
                    event.currentTarget.matches(":focus-visible"),
                  )
                }
                onBlur={() => setComposerFocus(false)}
                style={{ ...textareaStyle, ...focusRing(composerFocus) }}
              />
              <DetailActions>
                <Button
                  variant="primary"
                  disabled={draft.trim() === "" || busy !== null}
                  loading={busy === composer}
                  onClick={() => void handleReview(composer, draft.trim())}
                >
                  Send
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setComposer(null);
                    setDraft("");
                  }}
                >
                  Cancel
                </Button>
              </DetailActions>
            </div>
          )}
          {error && <Notice tone="destructive" label={error} />}
          <Collapsible title="Description" defaultOpen>
            {detail.body.trim() ? (
              <Markdown source={detail.body} />
            ) : (
              <div style={{ color: "var(--text-muted)" }}>No description</div>
            )}
          </Collapsible>
          <Collapsible
            title="CI checks"
            badge={<Chip>{detail.checks.length}</Chip>}
            defaultOpen={failing}
          >
            {detail.checks.length === 0 ? (
              <div style={{ color: "var(--text-muted)" }}>No checks</div>
            ) : (
              detail.checks.map((check) => (
                <div
                  key={`${check.name}-${check.url ?? ""}`}
                  style={checkRowStyle}
                >
                  <Chip tone={CHECK_TONE[check.state]}>
                    {CHECK_LABEL[check.state]}
                  </Chip>
                  {check.url ? (
                    <ExternalTextLink href={check.url}>
                      {check.name}
                    </ExternalTextLink>
                  ) : (
                    <span>{check.name}</span>
                  )}
                </div>
              ))
            )}
            {detail.checksTruncated && (
              <div style={{ color: "var(--text-muted)" }}>
                Showing the first {detail.checks.length} checks.
              </div>
            )}
          </Collapsible>
          <Collapsible
            title="Files"
            badge={<Chip>{detail.changedFiles}</Chip>}
            defaultOpen
          >
            {detail.files.map((file) => (
              <Collapsible
                key={file.filename}
                title={file.filename}
                badge={
                  <Chip>
                    +{file.additions} -{file.deletions}
                  </Chip>
                }
              >
                {file.patch === undefined ? (
                  <div style={{ color: "var(--text-muted)" }}>
                    No text diff for this file.
                  </div>
                ) : (
                  <pre style={patchStyle}>
                    {file.patch.split("\n").map((line, index) => (
                      <div key={index} style={{ color: lineColor(line) }}>
                        {line || " "}
                      </div>
                    ))}
                  </pre>
                )}
                {file.patchTruncated && (
                  <div style={{ color: "var(--text-muted)" }}>
                    Patch truncated
                  </div>
                )}
              </Collapsible>
            ))}
            {detail.filesTruncated && (
              <div style={{ color: "var(--text-muted)" }}>
                Showing the first {detail.files.length} files.
              </div>
            )}
          </Collapsible>
          {confirmMerge && (
            <MergeConfirmModal
              label={label}
              title={row.title}
              base={detail.base}
              onConfirm={() => handleMerge(detail)}
              onClose={() => setConfirmMerge(false)}
            />
          )}
        </>
      )}
    </DetailScroll>
  );
}
