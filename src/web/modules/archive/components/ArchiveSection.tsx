import type { ReactNode } from "react";
import type { ArchivedGroupSummary } from "../../../../shared/types.js";
import { ErrorAlert } from "@/components/ErrorAlert";
import {
  IDLE_ROW,
  type ArchiveRowState,
} from "@/modules/archive/domain/archive-row-state";
import { ArchiveRow } from "./ArchiveRow";

interface ArchiveSectionProps {
  rows: ArchivedGroupSummary[] | null;
  loadError: boolean;
  rowState: Record<string, ArchiveRowState>;
  onRestore: (id: string) => void;
  onDelete: (id: string, force: boolean) => void;
  children: ReactNode;
}

export function ArchiveSection({
  rows,
  loadError,
  rowState,
  onRestore,
  onDelete,
  children,
}: ArchiveSectionProps) {
  return (
    <section data-testid="archive-section" className="flex flex-col gap-4">
      <h2 className="text-sm font-medium text-muted-foreground">
        Archived groups
      </h2>
      {children}
      {loadError && (
        <ErrorAlert>
          Couldn't load the archive. Reopen the page to retry.
        </ErrorAlert>
      )}
      {!loadError && rows !== null && rows.length === 0 && (
        <span className="text-sm text-muted-foreground">
          No archived groups. Unwind a group to see it here.
        </span>
      )}
      {(rows ?? []).map((row) => (
        <ArchiveRow
          key={row.id}
          row={row}
          state={rowState[row.id] ?? IDLE_ROW}
          onRestore={() => onRestore(row.id)}
          onDelete={(force) => onDelete(row.id, force)}
        />
      ))}
    </section>
  );
}
