import type { ComponentProps } from "react";
import type { BoardSnapshot, WorktreeRow } from "../../../../shared/types.js";
import { PageColumn } from "@/components/PageColumn";
import { WorkspacesContainer } from "@/modules/workspaces/containers/WorkspacesContainer";

interface WorkspacesViewProps {
  board: BoardSnapshot;
  onSummaryChange: ComponentProps<
    typeof WorkspacesContainer
  >["onSummaryChange"];
  onOpenCard: (row: WorktreeRow) => void;
  onCleanupRequest: (row: WorktreeRow) => void;
}

export function WorkspacesView(props: WorkspacesViewProps) {
  return (
    <PageColumn>
      <WorkspacesContainer {...props} />
    </PageColumn>
  );
}
