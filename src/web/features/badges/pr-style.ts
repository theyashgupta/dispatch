import {
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
} from "lucide-react";
import type { PrInfo } from "../../../shared/types.js";

/**
 * Single source of PR state icon, colour, state label and CI dot colour.
 *
 * @remarks
 * `PrRow.tsx` carries a drifted second copy of this logic, and the
 * detail-panel PR list needs a third render site, so this logic lives in one
 * place before a third copy gets written. Names the SIG-04 drift class
 * `unknown-probe-copy.ts`'s doc block already warns about.
 */
export function prStyleFor(pr: PrInfo): {
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
