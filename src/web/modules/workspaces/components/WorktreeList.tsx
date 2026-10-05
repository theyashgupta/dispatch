import type { WorktreeRow as WorktreeRowModel } from "../../../../shared/types.js";
import { ItemGroup } from "@/components/ui/item";
import { worktreeActions } from "@/modules/workspaces/domain/workspace-rows";
import { WorktreeRow } from "./WorktreeRow";

interface WorktreeListProps {
  rows: WorktreeRowModel[] | null;
  editors: { code: boolean; cursor: boolean } | undefined;
  now: number;
  narrow: boolean;
  onOpenCard: (row: WorktreeRowModel) => void;
  onOpenEditor: (row: WorktreeRowModel, editor: "code" | "cursor") => void;
  onCleanupRequest: (row: WorktreeRowModel) => void;
}

export function WorktreeList({
  rows,
  editors,
  now,
  narrow,
  onOpenCard,
  onOpenEditor,
  onCleanupRequest,
}: WorktreeListProps) {
  if (rows === null) {
    return (
      <div className="py-2 text-sm text-muted-foreground">
        Reading worktrees…
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="py-2 text-sm text-muted-foreground">
        No worktrees on disk.
      </div>
    );
  }
  return (
    <ItemGroup>
      {rows.map((row) => {
        const actions = worktreeActions(row, editors);
        return (
          <WorktreeRow
            key={`${row.cardId}:${row.sessionId}`}
            row={row}
            now={now}
            narrow={narrow}
            actions={actions}
            onSelect={() => onOpenCard(row)}
            onOpenEditor={() => {
              if (actions.editor) onOpenEditor(row, actions.editor);
            }}
            onCleanup={() => onCleanupRequest(row)}
          />
        );
      })}
    </ItemGroup>
  );
}
