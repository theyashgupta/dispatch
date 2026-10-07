export interface FailedMoveNotice {
  id: number;
  count: number;
  settled: boolean;
  stranded: boolean;
}

export type FailedMoveEvent =
  | { type: "failed"; id: number; count: number }
  | { type: "stranded"; id: number }
  | { type: "settled"; id: number }
  | { type: "dismissed"; id: number }
  | { type: "succeeded" };

export const AUTO_DISMISS_MS = 3200;

/**
 * Next alert state for a group move event.
 *
 * @remarks
 * An event for an id that is no longer the current notice changes nothing, so a late compensation
 * result from a superseded move never edits or clears a newer alert. `failed` always replaces the
 * current notice, and `succeeded` always clears it.
 */
export function failedMoveReducer(
  prev: FailedMoveNotice | null,
  event: FailedMoveEvent,
): FailedMoveNotice | null {
  switch (event.type) {
    case "failed":
      return {
        id: event.id,
        count: event.count,
        settled: false,
        stranded: false,
      };
    case "succeeded":
      return null;
    case "stranded":
      return prev?.id === event.id ? { ...prev, stranded: true } : prev;
    case "settled":
      return prev?.id === event.id ? { ...prev, settled: true } : prev;
    case "dismissed":
      return prev?.id === event.id ? null : prev;
  }
}

/** The alert text for a failed group move. */
export function noticeLabel(count: number): string {
  return `Couldn't move ${count} ${count === 1 ? "ticket" : "tickets"}`;
}

/** True once compensation has settled and left no stranded card, the only state that clears itself. */
export function shouldAutoDismiss(notice: FailedMoveNotice | null): boolean {
  return notice != null && notice.settled && !notice.stranded;
}
