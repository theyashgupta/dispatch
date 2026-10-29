import type { Page } from "../../../../shared/route.js";

interface BottomBarSlot {
  label: string;
  page: Page | null;
}

export const BOTTOM_BAR_SLOTS: readonly BottomBarSlot[] = [
  { label: "Today", page: "today" },
  { label: "Inbox", page: "inbox" },
  { label: "New ticket", page: null },
  { label: "Board", page: "board" },
  { label: "Orchestrator", page: "orchestrator" },
];

export interface BarState {
  visible: boolean;
  anchor: number;
}

const BAR_SCROLL_THRESHOLD = 8;
const BAR_TOP_ZONE = 64;

/**
 * Return the bottom bar state after a scroll container reports a new scroll offset.
 *
 * @remarks An upward move that lands at the bottom edge while the bar is hidden is the scroll clamp caused by the bar's own height change, so it keeps the bar hidden and stops a hide and show loop.
 */
export function nextBarState(
  state: BarState,
  top: number,
  atBottom: boolean,
): BarState {
  if (atBottom && !state.visible && top < state.anchor) {
    return { visible: false, anchor: top };
  }
  if (top <= BAR_TOP_ZONE) return { visible: true, anchor: top };
  if (Math.abs(top - state.anchor) < BAR_SCROLL_THRESHOLD) return state;
  if (top > state.anchor) return { visible: false, anchor: top };
  return { visible: true, anchor: top };
}
