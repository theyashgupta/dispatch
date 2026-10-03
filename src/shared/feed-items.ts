import type { Item } from "./types.js";

/** The items the Inbox and Today show: Sentry items only when the errors preference is on. */
export function feedItems(
  items: readonly Item[],
  includeErrors: boolean,
): Item[] {
  if (includeErrors) return [...items];
  return items.filter((item) => item.source !== "sentry");
}

/** Whether a Sentry item belongs on the Errors page: neither done nor snoozed. */
export function isListedError(item: Item): boolean {
  return (
    item.source === "sentry" &&
    item.state !== "done" &&
    item.state !== "snoozed"
  );
}

/** Return the Sentry issue id behind a Sentry item id. */
export function sentryIssueId(itemId: string): string {
  return itemId.replace(/^sentry:/, "");
}

/** Check that a Sentry issue id is digits only, so it cannot change an API path. */
export function isSentryIssueId(issueId: string): boolean {
  return /^\d+$/.test(issueId);
}
