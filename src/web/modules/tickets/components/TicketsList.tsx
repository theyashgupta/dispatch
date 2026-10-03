import type { ReactNode } from "react";
import type { Card } from "../../../../shared/types.js";
import { ConnectSourceEmpty } from "@/components/ConnectSourceEmpty";
import { ListGroup } from "@/components/ListGroup";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import type {
  TicketGroup,
  TicketsGroupBy,
} from "@/modules/tickets/domain/ticket-rows";

interface TicketsListProps {
  totalCount: number;
  linearEnabled: boolean;
  groupBy: TicketsGroupBy;
  visibleRows: Card[];
  groups: TicketGroup[];
  renderRow: (card: Card) => ReactNode;
  onClearSearch: () => void;
  onOpenSettings: () => void;
}

export function TicketsList({
  totalCount,
  linearEnabled,
  groupBy,
  visibleRows,
  groups,
  renderRow,
  onClearSearch,
  onOpenSettings,
}: TicketsListProps) {
  if (totalCount === 0 && !linearEnabled) {
    return (
      <ConnectSourceEmpty
        testId="tickets-connect"
        description="Nothing feeds this page yet. Connect Linear in Settings and its tickets land here."
        onOpenSettings={onOpenSettings}
      />
    );
  }
  if (totalCount === 0) {
    return (
      <Empty className="py-12">
        <EmptyHeader>
          <EmptyTitle className="text-base font-semibold">
            No Linear tickets on the board
          </EmptyTitle>
          <EmptyDescription>
            Tickets that Linear sends to the board will show up here.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  if (visibleRows.length === 0) {
    return (
      <Empty className="py-12">
        <EmptyHeader>
          <EmptyTitle className="text-base font-semibold">
            No tickets match
          </EmptyTitle>
          <EmptyDescription>
            Try a different search or clear your filter.
          </EmptyDescription>
        </EmptyHeader>
        <Button type="button" variant="secondary" onClick={onClearSearch}>
          Clear filter
        </Button>
      </Empty>
    );
  }
  if (groupBy === "none") {
    return <>{visibleRows.map(renderRow)}</>;
  }
  return (
    <>
      {groups.map((group) => (
        <ListGroup
          key={group.key}
          title={group.label}
          count={group.rows.length}
          testId="tickets-group"
        >
          {group.rows.map(renderRow)}
        </ListGroup>
      ))}
    </>
  );
}
