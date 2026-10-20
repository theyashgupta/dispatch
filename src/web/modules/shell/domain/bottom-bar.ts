import type { Page } from "../../../../shared/route.js";

interface BottomBarSlot {
  id: string;
  label: string;
  page: Page | null;
}

export const BOTTOM_BAR_SLOTS: readonly BottomBarSlot[] = [
  { id: "today", label: "Today", page: "today" },
  { id: "inbox", label: "Inbox", page: "inbox" },
  { id: "new-ticket", label: "New ticket", page: null },
  { id: "board", label: "Board", page: "board" },
  { id: "orchestrator", label: "Orchestrator", page: "orchestrator" },
];

/** Return the id of the bottom bar slot that opens the given page, or null. */
export function currentSlotId(page: Page): string | null {
  return BOTTOM_BAR_SLOTS.find((slot) => slot.page === page)?.id ?? null;
}
