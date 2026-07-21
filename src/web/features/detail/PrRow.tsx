import {
  ExternalLink,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
} from "lucide-react";
import type { PrInfo } from "../../../shared/types.js";
import { IconButton } from "../../primitives/IconButton.js";

function styleFor(pr: PrInfo): {
  icon: typeof GitPullRequest;
  color: string;
} {
  if (pr.isDraft) {
    return { icon: GitPullRequestDraft, color: "var(--text-muted)" };
  }
  if (pr.state === "merged") {
    return { icon: GitMerge, color: "var(--col-in-review)" };
  }
  if (pr.state === "closed") {
    return { icon: GitPullRequestClosed, color: "var(--col-done)" };
  }
  return { icon: GitPullRequest, color: "var(--status-ok)" };
}

function stateLabelFor(pr: PrInfo): string {
  if (pr.isDraft) return "Draft";
  if (pr.state === "merged") return "Merged";
  if (pr.state === "closed") return "Closed";
  return "Open";
}

export function PrRow({ pr }: { pr: PrInfo }) {
  const { icon: Icon, color } = styleFor(pr);
  const ciWord =
    pr.ci === "pass" ? "passing" : pr.ci === "fail" ? "failing" : "pending";
  const summary = `${stateLabelFor(pr)}${pr.ci != null ? ` · Checks ${ciWord}` : ""}`;
  return (
    <div
      style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)" }}
    >
      <Icon
        size={14}
        strokeWidth={2}
        aria-hidden="true"
        style={{ flex: "0 0 auto", color }}
      />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: "1 1 auto",
          minWidth: 0,
        }}
      >
        <span
          style={{
            fontSize: "var(--font-body)",
            fontWeight: "var(--weight-semibold)",
            lineHeight: "var(--line-body)",
            color: "var(--text)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {`#${pr.number} ${pr.title}`}
        </span>
        <span
          style={{
            fontSize: "var(--font-label)",
            fontWeight: "var(--weight-regular)",
            lineHeight: "var(--line-label)",
            color,
          }}
        >
          {summary}
        </span>
      </div>
      <IconButton
        aria-label={`Open PR #${pr.number} in browser`}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          window.open(pr.url, "_blank", "noopener,noreferrer");
        }}
      >
        <ExternalLink size={14} strokeWidth={2} aria-hidden="true" />
      </IconButton>
    </div>
  );
}
