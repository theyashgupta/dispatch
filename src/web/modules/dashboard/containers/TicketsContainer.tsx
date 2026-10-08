import { useMemo, useState } from "react";
import { withBoard } from "../../../../shared/board-select.js";
import type { Column } from "../../../../shared/types.js";
import { TicketsSection } from "@/modules/dashboard/components/TicketsSection";
import { sectionState } from "@/modules/dashboard/domain/section-state";
import {
  filterCards,
  groupOptions,
  ticketsByColumn,
} from "@/modules/dashboard/domain/tickets-by-column";
import { retryFailed, useDashboardData } from "./use-dashboard-data";

const ALL = "all";

export function TicketsContainer() {
  const { boardKey, snapshot } = useDashboardData();
  const [groupValue, setGroupValue] = useState(ALL);
  const [columnValue, setColumnValue] = useState(ALL);
  const allCards = snapshot.data?.cards;
  const rows = useMemo(() => ticketsByColumn(allCards ?? []), [allCards]);
  const groups = useMemo(() => groupOptions(allCards ?? []), [allCards]);
  const cards = useMemo(
    () =>
      filterCards(allCards ?? [], {
        groupId: groupValue === ALL ? undefined : groupValue,
        column: columnValue === ALL ? undefined : (columnValue as Column),
      }),
    [allCards, groupValue, columnValue],
  );
  return (
    <TicketsSection
      state={sectionState([snapshot])}
      rows={rows}
      total={rows.reduce((sum, row) => sum + row.cards.length, 0)}
      openBoardHref={withBoard("#/board", boardKey)}
      groups={groups}
      groupValue={groupValue}
      columnValue={columnValue}
      onGroupChange={setGroupValue}
      onColumnChange={setColumnValue}
      cards={cards}
      onRetry={() => retryFailed([snapshot])}
    />
  );
}
