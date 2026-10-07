import type { ArchivedGroupSummary } from "../../../../shared/types.js";
import { formatAge, nowMs } from "../../../../shared/format-age.js";
import { ErrorAlert } from "@/components/ErrorAlert";
import { Button } from "@/components/ui/button";
import type { ArchiveRowState } from "@/modules/archive/domain/archive-row-state";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemTitle,
} from "@/components/ui/item";

interface ArchiveRowProps {
  row: ArchivedGroupSummary;
  state: ArchiveRowState;
  onRestore: () => void;
  onDelete: (force: boolean) => void;
}

export function ArchiveRow({
  row,
  state,
  onRestore,
  onDelete,
}: ArchiveRowProps) {
  const blocked = row.deleteBlocked != null;
  const reason = state.error ?? row.deleteBlocked ?? null;
  const members = row.members.map((m) => m.identifier).join(", ");
  const destination = row.destination === "inbox" ? "Inbox" : "To Do";
  return (
    <Item
      variant="outline"
      size="sm"
      className="gap-1 bg-card px-3 py-2"
      data-testid={`archived-${row.identifier}`}
    >
      <ItemContent>
        <ItemTitle className="w-full flex-wrap items-baseline">
          <span className="font-semibold">{row.identifier}</span>
          <span className="min-w-0 truncate font-normal">{row.title}</span>
          <span className="text-sm font-normal text-muted-foreground">
            {formatAge(row.archivedAt, nowMs())}
          </span>
        </ItemTitle>
        <ItemDescription className="line-clamp-none">
          {`${members} sent to ${destination}`}
        </ItemDescription>
        {reason && <ErrorAlert>{reason}</ErrorAlert>}
      </ItemContent>
      <ItemFooter className="flex-wrap justify-start">
        <Button size="sm" disabled={state.busy} onClick={onRestore}>
          Restore
        </Button>
        <Button
          size="sm"
          variant="destructive"
          disabled={state.busy}
          onClick={() => onDelete(false)}
        >
          Delete
        </Button>
        {blocked && (
          <Button
            size="sm"
            variant="destructive"
            disabled={state.busy}
            onClick={() => onDelete(true)}
          >
            Delete anyway
          </Button>
        )}
      </ItemFooter>
    </Item>
  );
}
