import type { SourceIssue } from "../../shared/types.js";

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
 * upstream; the generic poll loop owns backoff policy, scheduling, and last-known-good. Thin by
 * design: `id` (becomes Card.source) plus `fetch()` — no filter or capability surface yet.
 */
export interface TicketSource {
  readonly id: string;
  fetch(): Promise<{ issues: SourceIssue[]; truncated: boolean }>;
}
