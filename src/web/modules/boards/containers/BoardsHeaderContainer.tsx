import { staleCountsLabel } from "../../../../shared/board-select.js";
import { PageHeaderActions } from "@/components/PageHeaderActions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useBoardsNavigation } from "./use-boards-navigation";
import {
  useBoardCountsQuery,
  useBoardListQuery,
} from "@/queries/board-list-queries";

export function BoardsHeaderContainer() {
  const nav = useBoardsNavigation();
  const list = useBoardListQuery();
  const counts = useBoardCountsQuery();
  const staleLabel = staleCountsLabel(counts);
  return (
    <>
      {staleLabel !== null && <Badge tone="neutral">{staleLabel}</Badge>}
      <PageHeaderActions>
        <Button
          size="sm"
          disabled={list.data === undefined}
          onClick={nav.openCreateDialog}
        >
          New board
        </Button>
      </PageHeaderActions>
    </>
  );
}
