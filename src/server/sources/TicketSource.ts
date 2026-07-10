import type { SourceFilters, SourceIssue } from "../../shared/types.js";

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
 * A filter dimension a source can constrain on. `cycle` is a boolean toggle (no option list); the
 * rest are multi-select id lists. Source-neutral so the settings UI renders only what a source
 * declares in its capability descriptor (SRC-06).
 */
export type FilterDimension = "assignees" | "projects" | "teams" | "cycle";

/** One selectable option for a multi-select dimension: the upstream id plus its human label. */
export interface FilterOption {
  id: string;
  label: string;
}

/**
 * A source's static filter surface — the dimensions it supports. The settings UI iterates this to
 * decide which controls to render, so a source never advertises a dimension it cannot query.
 */
export interface FilterCapabilities {
  dimensions: FilterDimension[];
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
  ): Promise<FilterOption[]>;
  countMatches(
    filters: SourceFilters,
  ): Promise<{ count: number; more: boolean }>;
}
