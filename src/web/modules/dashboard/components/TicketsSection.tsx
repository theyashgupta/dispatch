import { ChevronRight } from "lucide-react";
import type { Card } from "../../../../shared/types.js";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Item, ItemContent, ItemGroup, ItemTitle } from "@/components/ui/item";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { SectionState } from "@/modules/dashboard/domain/section-state";
import type { ColumnRow } from "@/modules/dashboard/domain/tickets-by-column";
import { DashboardSection } from "./DashboardSection";

interface TicketsSectionProps {
  state: SectionState;
  rows: ColumnRow[];
  total: number;
  openBoardHref: string;
  groups: { id: string; label: string }[];
  groupValue: string;
  columnValue: string;
  onGroupChange: (value: string) => void;
  onColumnChange: (value: string) => void;
  cards: Card[];
  onRetry: () => void;
}

function OrchestratorCount({ count }: { count: number }) {
  return (
    <span className="flex items-center gap-2 tabular-nums">
      {count}
      {count > 0 && <Badge tone="neutral">By orchestrator</Badge>}
    </span>
  );
}

export function TicketsSection({
  state,
  rows,
  total,
  openBoardHref,
  groups,
  groupValue,
  columnValue,
  onGroupChange,
  onColumnChange,
  cards,
  onRetry,
}: TicketsSectionProps) {
  return (
    <DashboardSection
      title="Tickets by column"
      count={total}
      state={state}
      onRetry={onRetry}
      action={
        <Button asChild variant="link" size="sm" className="h-auto p-0">
          <a href={openBoardHref}>Open board</a>
        </Button>
      }
    >
      <div className="hidden rounded-md border border-border bg-card md:block">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead scope="col">Column</TableHead>
              <TableHead scope="col">Cards</TableHead>
              <TableHead scope="col">By orchestrator</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.column}>
                <TableCell>{row.label}</TableCell>
                <TableCell className="tabular-nums">
                  {row.cards.length}
                </TableCell>
                <TableCell>
                  <OrchestratorCount count={row.byOrchestrator} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ItemGroup className="rounded-md border border-border bg-card md:hidden">
        {rows.map((row) => (
          <Item
            key={row.column}
            role="listitem"
            size="sm"
            className="flex-nowrap border-0 border-b last:border-b-0"
          >
            <ItemContent className="min-w-0">
              <span className="text-xs text-muted-foreground tabular-nums">
                {row.cards.length === 1
                  ? "1 card"
                  : `${row.cards.length} cards`}
              </span>
              <ItemTitle>{row.label}</ItemTitle>
              {row.byOrchestrator > 0 && (
                <OrchestratorCount count={row.byOrchestrator} />
              )}
            </ItemContent>
          </Item>
        ))}
      </ItemGroup>
      <Collapsible className="flex flex-col gap-2">
        <CollapsibleTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="group/trigger self-start"
          >
            <ChevronRight
              aria-hidden="true"
              className="transition-transform group-data-[state=open]/trigger:rotate-90"
            />
            Show cards
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <Select value={groupValue} onValueChange={onGroupChange}>
              <SelectTrigger aria-label="Group" className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All groups</SelectItem>
                {groups.map((group) => (
                  <SelectItem key={group.id} value={group.id}>
                    {group.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={columnValue} onValueChange={onColumnChange}>
              <SelectTrigger aria-label="Column" className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All columns</SelectItem>
                {rows.map((row) => (
                  <SelectItem key={row.column} value={row.column}>
                    {row.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {cards.length === 0 ? (
            <p className="m-0 text-sm text-muted-foreground">No cards match.</p>
          ) : (
            <ItemGroup className="rounded-md border border-border bg-card">
              {cards.map((card) => (
                <Item
                  key={card.id}
                  role="listitem"
                  size="sm"
                  className="flex-nowrap border-0 border-b last:border-b-0"
                >
                  <ItemContent className="min-w-0">
                    <ItemTitle className="min-w-0">
                      <span className="font-mono text-xs text-muted-foreground">
                        {card.identifier}
                      </span>
                      <span className="min-w-0 truncate">{card.title}</span>
                    </ItemTitle>
                  </ItemContent>
                </Item>
              ))}
            </ItemGroup>
          )}
        </CollapsibleContent>
      </Collapsible>
    </DashboardSection>
  );
}
