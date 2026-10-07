import { SWITCH_NOW_REASON } from "../../../../shared/account-chain.js";
import type { ChainAccountState } from "../../../../shared/types.js";

export type ChainBadgeTone = "success" | "warning" | "danger" | "neutral";

const STATES: Record<
  ChainAccountState,
  { label: string; tone: ChainBadgeTone }
> = {
  available: { label: "Available", tone: "success" },
  "near-limit": { label: "Near limit", tone: "warning" },
  limited: { label: "Limited", tone: "danger" },
  "login-expired": { label: "Login expired", tone: "danger" },
  unknown: { label: "Unknown", tone: "neutral" },
};

/** Name a chain account state in words and pick the badge tone for it. */
export function chainStateBadge(state: ChainAccountState): {
  label: string;
  tone: ChainBadgeTone;
} {
  return STATES[state];
}

/**
 * Name why the chain moved, from the reason string the server stored.
 *
 * @remarks The server stores "switch-now" for a manual move and "reset" for one that followed a
 * reset. Every other reason came from a usage limit.
 */
export function moveReasonLabel(reason: string): string {
  if (reason === SWITCH_NOW_REASON) return "Switched now";
  if (reason === "reset") return "After a reset";
  return "Usage limit";
}
