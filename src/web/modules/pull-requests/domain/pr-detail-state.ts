import type {
  PrCheckState,
  PrDetail,
  PrReviewEvent,
} from "../../../../shared/types.js";

export type PrTone = "neutral" | "danger" | "warning" | "success";

export type PatchLineKind = "add" | "remove" | "hunk" | "context";

export const CHECK_TONE: Record<PrCheckState, PrTone> = {
  fail: "danger",
  pending: "warning",
  pass: "success",
};

export const CHECK_LABEL: Record<PrCheckState, string> = {
  fail: "Failing",
  pending: "Pending",
  pass: "Passing",
};

/** Return the tone and label of the state badge in a pull request header. */
export function prStateBadge(detail: PrDetail): {
  tone: PrTone;
  label: string;
} {
  if (detail.state === "merged") return { tone: "success", label: "Merged" };
  if (detail.state === "closed") return { tone: "danger", label: "Closed" };
  return { tone: "neutral", label: detail.draft ? "Draft" : "Open" };
}

/** Classify one line of a unified diff patch. */
export function patchLineKind(line: string): PatchLineKind {
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "remove";
  if (line.startsWith("@@")) return "hunk";
  return "context";
}

/** Return the notice shown after a review is sent. */
export function reviewNotice(event: PrReviewEvent, label: string): string {
  if (event === "APPROVE") return `Approved ${label}.`;
  if (event === "REQUEST_CHANGES") return `Requested changes on ${label}.`;
  return `Commented on ${label}.`;
}
