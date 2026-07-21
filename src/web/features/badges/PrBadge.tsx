import {
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
} from "lucide-react";
import { useState } from "react";
import type { PrInfo } from "../../../shared/types.js";

function styleFor(pr: PrInfo): {
  icon: typeof GitPullRequest;
  border: string;
  background: string;
  color: string;
} {
  if (pr.isDraft) {
    return {
      icon: GitPullRequestDraft,
      border: "1px solid var(--border)",
      background: "transparent",
      color: "var(--text-muted)",
    };
  }
  if (pr.state === "merged") {
    return {
      icon: GitMerge,
      border: "none",
      background:
        "color-mix(in srgb, var(--col-in-review) 16%, var(--surface-card))",
      color: "var(--col-in-review)",
    };
  }
  if (pr.state === "closed") {
    return {
      icon: GitPullRequestClosed,
      border: "none",
      background:
        "color-mix(in srgb, var(--col-done) 16%, var(--surface-card))",
      color: "var(--col-done)",
    };
  }
  return {
    icon: GitPullRequest,
    border: "none",
    background: "color-mix(in srgb, var(--status-ok) 16%, var(--surface-card))",
    color: "var(--status-ok)",
  };
}

function stateLabelFor(pr: PrInfo): string {
  if (pr.isDraft) return "Draft";
  if (pr.state === "merged") return "Merged";
  if (pr.state === "closed") return "Closed";
  return "Open";
}

function ciDotColor(ci: PrInfo["ci"]): string {
  if (ci === "fail") return "var(--destructive)";
  if (ci === "pending") return "var(--status-stale)";
  return "var(--status-ok)";
}

export function PrBadge({ pr }: { pr: PrInfo }) {
  const [hovered, setHovered] = useState(false);
  const { icon: Icon, border, background, color } = styleFor(pr);
  const showCiDot = !pr.isDraft && pr.state === "open" && pr.ci != null;
  const ciLabel =
    pr.ci != null
      ? ` · Checks ${pr.ci === "pass" ? "passing" : pr.ci === "fail" ? "failing" : "pending"}`
      : "";
  const label = `PR #${pr.number} — ${stateLabelFor(pr)}${ciLabel}`;
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        window.open(pr.url, "_blank", "noopener,noreferrer");
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        flex: "0 0 auto",
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--space-xs)",
        borderRadius: "var(--radius)",
        padding: "0 var(--space-xs)",
        fontSize: "var(--font-label)",
        fontWeight: "var(--weight-semibold)",
        lineHeight: "var(--line-label)",
        whiteSpace: "nowrap",
        border,
        background,
        color,
        cursor: "pointer",
        fontFamily: "inherit",
        opacity: hovered ? 0.85 : 1,
      }}
    >
      <Icon size={12} strokeWidth={2} aria-hidden="true" />
      {`#${pr.number}`}
      {showCiDot && (
        <span
          style={{
            width: "5px",
            height: "5px",
            borderRadius: "50%",
            flex: "0 0 auto",
            background: ciDotColor(pr.ci),
          }}
        />
      )}
    </button>
  );
}
