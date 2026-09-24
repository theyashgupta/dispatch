import type {
  FilterOption,
  Item,
  SourceIssue,
  SourceKind,
} from "../../shared/types.js";
import { DEFAULT_POLL_INTERVAL_MS } from "../../shared/types.js";
import type { TicketSource } from "../sources/ticket.source.js";

export interface FakeSourceOptions {
  id: string;
  kind?: SourceKind;
  pollIntervalMs?: number;
  vaultKeys?: readonly string[];
  fetch?: () => Promise<{
    issues: SourceIssue[];
    items?: Item[];
    truncated: boolean;
  }>;
}

/**
 * A TicketSource test double with a swappable fetch and no network.
 *
 * @remarks `listOptions` and `countMatches` return empty results so a fake can stand in wherever
 * the registry hands a source to a route.
 */
export function makeFakeSource(opts: FakeSourceOptions): TicketSource {
  return {
    id: opts.id,
    kind: opts.kind ?? "snapshot",
    pollIntervalMs: opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
    vaultKeys: opts.vaultKeys ?? [],
    capabilities: { dimensions: [] },
    fetch:
      opts.fetch ?? (() => Promise.resolve({ issues: [], truncated: false })),
    listOptions: (): Promise<{ options: FilterOption[]; truncated: boolean }> =>
      Promise.resolve({ options: [], truncated: false }),
    countMatches: (): Promise<{ count: number; more: boolean }> =>
      Promise.resolve({ count: 0, more: false }),
  };
}

export function issue(
  id: string,
  extra: Partial<SourceIssue> = {},
): SourceIssue {
  return {
    id,
    identifier: id.toUpperCase(),
    title: `Issue ${id}`,
    url: `https://example.test/${id}`,
    description: null,
    priority: 2,
    updatedAt: "2026-09-24T10:00:00.000Z",
    project: null,
    state: { name: "Todo", type: "unstarted" },
    ...extra,
  };
}

/** A test item; the id follows the `<source>:<key>` shape from the extra's source or "fake". */
export function fakeItem(key: string, extra: Partial<Item> = {}): Item {
  const source = extra.source ?? "fake";
  return {
    id: `${source}:${key}`,
    source,
    type: "pr_review",
    title: `Item ${key}`,
    snippet: `Snippet ${key}`,
    createdAt: "2026-09-24T09:00:00.000Z",
    priority: 50,
    state: "unread",
    meta: { repo: "acme/app" },
    ...extra,
  };
}
