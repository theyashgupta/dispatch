import type {
  FilterCapabilities,
  FilterDimension,
  FilterOption,
  SourceFilters,
  SourceIssue,
} from "../../shared/types.js";

export type {
  FilterCapabilities,
  FilterDimension,
  FilterOption,
} from "../../shared/types.js";

/**
 * Thrown by a TicketSource when its provider signals rate-limiting, so the generic poll loop can
 * back off instead of crash. Source-neutral replacement for the poller's former local
 * RateLimitedError — the loop catches this sentinel to keep last-known-good.
 */
export class RateLimited extends Error {
  constructor() {
    super("ticket source rate-limited");
    this.name = "RateLimited";
  }
}

/**
 * A pluggable ticket provider. Owns fetch/paging/normalization and rate-limit detection for one
 * upstream; the generic poll loop owns backoff policy, scheduling, and last-known-good. `id` becomes
 * Card.source; `capabilities` drives the settings UI; `listOptions`/`countMatches` back the live
 * dropdowns and the match-count preview through the SAME builder the poll uses.
 */
export interface TicketSource {
  readonly id: string;
  fetch(): Promise<{ issues: SourceIssue[]; truncated: boolean }>;
  readonly capabilities: FilterCapabilities;
  listOptions(
    dimension: Exclude<FilterDimension, "cycle">,
  ): Promise<{ options: FilterOption[]; truncated: boolean }>;
  countMatches(
    filters: SourceFilters,
  ): Promise<{ count: number; more: boolean }>;
}
