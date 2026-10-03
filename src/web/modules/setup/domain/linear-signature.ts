import type { SourceConnection } from "../../../../shared/types.js";

export interface LinearSeen {
  baseline: string | null;
  latest: string | null;
}

export function linearSignature(c: SourceConnection): string {
  return `${c.configured}|${c.connected}|${c.account ?? ""}`;
}

/**
 * Record one Linear connection read.
 *
 * @remarks
 * The first read becomes the baseline and every read becomes the latest.
 */
export function noteLinear(seen: LinearSeen, c: SourceConnection): LinearSeen {
  const signature = linearSignature(c);
  return { baseline: seen.baseline ?? signature, latest: signature };
}

export function linearChanged(seen: LinearSeen): boolean {
  return seen.latest !== seen.baseline;
}
