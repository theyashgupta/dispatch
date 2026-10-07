import type { Page } from "../../../../shared/route.js";

export const BOARD_PAGES: readonly Page[] = [
  "board",
  "inbox",
  "today",
  "tickets",
  "sessions",
  "workspace",
  "workspaces",
  "flow",
  "activity",
  "archive",
];

/** Append the board name to the title of a board page, or return the title unchanged (U3-12). */
export function boardPageTitle(
  page: Page,
  title: string,
  boardName: string | null,
): string {
  return boardName !== null && BOARD_PAGES.includes(page)
    ? `${title} · ${boardName}`
    : title;
}
