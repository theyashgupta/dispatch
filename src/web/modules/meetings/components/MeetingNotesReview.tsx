import { ErrorAlert } from "@/components/ErrorAlert";
import { DraftReviewRow } from "./DraftReviewRow";
import type { ReviewRow } from "@/modules/meetings/domain/draft-rows";

interface MeetingNotesReviewProps {
  rows: ReviewRow[];
  meeting: string;
  creating: boolean;
  blankTitle: boolean;
  createError: string | null;
  onRowChange: (index: number, next: ReviewRow) => void;
}

export function MeetingNotesReview({
  rows,
  meeting,
  creating,
  blankTitle,
  createError,
  onRowChange,
}: MeetingNotesReviewProps) {
  if (rows.length === 0) {
    return (
      <span className="text-base text-muted-foreground">
        No action items for you in these notes.
      </span>
    );
  }
  return (
    <>
      <h3 className="m-0 text-base font-medium wrap-anywhere">
        {rows.length === 1
          ? `1 action item from ${meeting}`
          : `${rows.length} action items from ${meeting}`}
      </h3>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {rows.map((row, index) => (
          <DraftReviewRow
            key={row.draft.key}
            row={row}
            disabled={creating}
            onChange={(next) => onRowChange(index, next)}
          />
        ))}
      </ul>
      {blankTitle && (
        <span className="text-sm text-muted-foreground">
          Every checked item needs a title.
        </span>
      )}
      {createError !== null && <ErrorAlert>{createError}</ErrorAlert>}
    </>
  );
}
