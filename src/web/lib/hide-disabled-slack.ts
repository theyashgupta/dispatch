import type { Item } from "../../shared/types.js";

/**
 * Drop Slack items while the Slack source is not enabled, keeping every other source's items.
 *
 * @remarks The items stay stored; switching Slack back on shows them unchanged (R-09, U2-11).
 */
export function hideDisabledSlack(
  items: readonly Item[],
  enabledSources: readonly string[],
): Item[] {
  return enabledSources.includes("slack")
    ? [...items]
    : items.filter((item) => item.source !== "slack");
}
