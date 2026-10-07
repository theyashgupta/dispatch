import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
} from "@/components/ui/pagination";
import { EntryRow } from "./EntryRow";
import type { TodayEntry } from "@/modules/today/domain/p0";
import { pagerState } from "@/modules/today/domain/pager-state";
import type { Paged } from "@/modules/today/domain/today-view";

interface TodayListProps {
  list: Paged<TodayEntry>;
  onPageChange: (page: number) => void;
  onOpen: (entry: TodayEntry) => void;
  now: number;
}

export function TodayList({ list, onPageChange, onOpen, now }: TodayListProps) {
  const { rows, page: current, pages } = list;
  const { previousDisabled, nextDisabled } = pagerState(current, pages);
  return (
    <section aria-label="Top of your list" className="flex flex-col gap-2">
      <h2 className="m-0 text-sm leading-(--line-label) font-semibold text-muted-foreground">
        Top of your list
      </h2>
      <Card className="gap-0 py-0">
        <ul role="list" className="m-0 list-none p-0">
          {rows.map((entry) => (
            <li key={entry.key}>
              <EntryRow
                entry={entry}
                id={`today-row-${entry.key}`}
                now={now}
                onOpen={onOpen}
              />
            </li>
          ))}
        </ul>
        <Pagination className="mx-0 justify-end border-t border-border px-(--space-lg) py-2">
          <PaginationContent className="gap-2">
            <PaginationItem>
              <Button
                variant="secondary-bordered"
                size="sm"
                disabled={previousDisabled}
                onClick={() => onPageChange(current - 1)}
              >
                Previous
              </Button>
            </PaginationItem>
            <PaginationItem>
              <span className="block text-sm leading-(--line-body) text-muted-foreground">
                Page {current} of {pages}
              </span>
            </PaginationItem>
            <PaginationItem>
              <Button
                variant="secondary-bordered"
                size="sm"
                disabled={nextDisabled}
                onClick={() => onPageChange(current + 1)}
              >
                Next
              </Button>
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      </Card>
    </section>
  );
}
