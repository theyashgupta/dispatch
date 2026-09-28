import type { Item } from "../../shared/types.js";
import type { InboxRowModel } from "./actions.js";

const ACRONYMS: Record<string, string> = { pr: "PR", ci: "CI", dm: "DM" };

/** Upper-case the first character. */
export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Turn a connector type key such as `pr_review` into the label `PR review`. */
export function humanizeType(type: string): string {
  return capitalize(
    type
      .split(/[_\s-]+/)
      .filter(Boolean)
      .map((w) => ACRONYMS[w] ?? w)
      .join(" "),
  );
}

/** Build the Inbox row model for one item. */
export function itemRow(item: Item): InboxRowModel {
  return {
    kind: "item",
    id: item.id,
    source: item.source,
    title: item.title,
    snippet: item.snippet,
    priority: item.priority,
    time: item.createdAt,
    unread: item.state === "unread",
    url: item.url,
    typeLabel: humanizeType(item.type),
    item,
  };
}
