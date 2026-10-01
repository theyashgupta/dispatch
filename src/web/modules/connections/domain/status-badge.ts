import type { SourceCardStatus } from "../../../../shared/types.js";

export interface StatusBadgeState {
  tone: "success" | "danger" | "neutral";
  label: string;
  account?: string;
}

const NEUTRAL_LABEL: Record<
  "checking" | "disconnected" | "soon" | "off",
  string
> = {
  checking: "Checking",
  disconnected: "Not connected",
  soon: "Coming soon",
  off: "Off",
};

/** Map a card status to the badge tone and text its header shows. */
export function statusBadgeState(status: SourceCardStatus): StatusBadgeState {
  if (status.kind === "connected") {
    return status.account
      ? { tone: "success", label: "Connected", account: status.account }
      : { tone: "success", label: "Connected" };
  }
  if (status.kind === "error") {
    return { tone: "danger", label: status.message };
  }
  return { tone: "neutral", label: NEUTRAL_LABEL[status.kind] };
}
