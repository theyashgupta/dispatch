import type { ProbeFailureCategory } from "../../../shared/types.js";

/**
 * The sole source of "could not check" copy for both the card badge and the detail-panel row, so
 * the two render sites can never drift (SIG-04). `label` is the short visible badge text; `detail`
 * is the longer category-specific sentence shown as a tooltip on the card and as visible text in
 * the detail panel.
 *
 * `partial` is set by a render site that is showing surviving PR/preview data NEXT TO this unknown
 * state — the multi-repo case where one repo answered and another failed. Bare "PR unknown" beside
 * a live PR badge reads as a claim about that PR; "PR check incomplete" says what is actually true,
 * that some of the signal is missing rather than all of it. It stays in this helper rather than at
 * the render sites so the card, panel and member rows cannot drift.
 *
 * The switch deliberately has NO `default` arm: `ProbeFailureCategory` is a closed union, so
 * omitting it makes a widened union fail `tsc` here ("lacks ending return statement") instead of
 * silently rendering a bare "Could not check" with no reason — in the one component whose entire
 * purpose is explaining why a signal is unknown.
 */
export function unknownProbeCopy(
  signal: "pr" | "preview",
  category: ProbeFailureCategory,
  partial = false,
): { label: string; detail: string } {
  const noun = signal === "pr" ? "PR" : "Preview";
  const label = partial ? `${noun} check incomplete` : `${noun} unknown`;
  switch (category) {
    case "gh not authenticated":
      return {
        label,
        detail: "Could not check: not authenticated for this repo",
      };
    case "gh repo not accessible":
      return {
        label,
        detail:
          "Could not check: this repo is not visible to the signed-in gh account, or the remote no longer exists",
      };
    case "gh unavailable":
      return { label, detail: "Could not check: gh CLI not available" };
    case "repo path missing":
      return {
        label,
        detail: "Could not check: this card's repo folder no longer exists",
      };
    case "gh pr list failed":
      return { label, detail: "Could not check: gh lookup failed" };
    case "detection unavailable":
      return { label, detail: "Could not check: detection tooling failed" };
  }
}
