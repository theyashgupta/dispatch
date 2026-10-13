import { hideDisabledSlack } from "./hide-disabled-slack.js";
import type { Item } from "./types.js";

/** Whether an item is still open: neither done nor dismissed. */
export function isOpenItem(item: Item): boolean {
  return item.state !== "done" && item.state !== "dismissed";
}

/**
 * Whether an item is an open Slack item that needs a session.
 *
 * @remarks Linear reaches the Inbox as cards; GitHub, Sentry, Calendar and Meeting items stay on their own pages.
 */
export function isInboxItem(item: Item): boolean {
  return (
    item.source === "slack" &&
    item.meta.needsSession === "true" &&
    isOpenItem(item)
  );
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

/** The items the Inbox, its badge and Today list: Slack items that need a session, Slack hidden while it is off. */
export function inboxFeed(
  items: readonly Item[],
  enabledSources: readonly string[],
): Item[] {
  return hideDisabledSlack(items.filter(isInboxItem), enabledSources);
}

/** The items the Inbox lists under Dismissed: items with state dismissed, Slack hidden while it is off. */
export function dismissedFeed(
  items: readonly Item[],
  enabledSources: readonly string[],
): Item[] {
  return hideDisabledSlack(
    items.filter((item) => item.state === "dismissed"),
    enabledSources,
  );
}
