import {
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
} from "lucide-react";
import type { PrInfo } from "../../../shared/types.js";

/**
 * Return the PR state icon, colour and badge class.
 *
 * @remarks The detail-panel PR list and the PR badge both render from this one place so the two
 * cannot drift apart.
 */
export function prStyleFor(pr: PrInfo): {
  icon: typeof GitPullRequest;
  color: string;
  className: string;
} {
  if (pr.isDraft) {
    return {
      icon: GitPullRequestDraft,
      color: "var(--text-muted)",
      className: "border-border bg-transparent text-muted-foreground",
    };
  }
  if (pr.state === "merged") {
    return {
      icon: GitMerge,
      color: "color-mix(in srgb, var(--col-in-review) 35%, var(--text))",
      className:
        "border-0 bg-[color-mix(in_srgb,var(--col-in-review)_16%,var(--surface-card))] text-[color-mix(in_srgb,var(--col-in-review)_35%,var(--text))]",
    };
  }
  if (pr.state === "closed") {
    return {
      icon: GitPullRequestClosed,
      color: "color-mix(in srgb, var(--col-done) 35%, var(--text))",
      className:
        "border-0 bg-[color-mix(in_srgb,var(--col-done)_16%,var(--surface-card))] text-[color-mix(in_srgb,var(--col-done)_35%,var(--text))]",
    };
  }
  return {
    icon: GitPullRequest,
    color: "var(--status-ok)",
    className:
      "border-0 bg-[color-mix(in_srgb,var(--status-ok)_16%,var(--surface-card))] text-(--status-ok)",
  };
}

export function prStateLabel(pr: PrInfo): string {
  if (pr.isDraft) return "Draft";
  if (pr.state === "merged") return "Merged";
  if (pr.state === "closed") return "Closed";
  return "Open";
}

export function prCiDotColor(ci: PrInfo["ci"]): string {
  if (ci === "fail") return "var(--destructive)";
  if (ci === "pending") return "var(--status-stale)";
  return "var(--status-ok)";
}

/** Return the Tailwind background class for the CI dot, matching the colour `prCiDotColor` returns. */
export function prCiDotClass(ci: PrInfo["ci"]): string {
  if (ci === "fail") return "bg-destructive";
  if (ci === "pending") return "bg-(--status-stale)";
  return "bg-(--status-ok)";
}
