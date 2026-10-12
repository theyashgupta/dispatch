import type { KeyboardEvent, MouseEvent } from "react";
import type { PrFilters, PrRow } from "../../../../shared/pr-rows.js";
import { formatAge, nowMs } from "../../../../shared/format-age.js";
import { CHECK_TONE } from "@/modules/pull-requests/domain/pr-detail-state";
import { STATE_TONE } from "@/modules/pull-requests/domain/pr-list-copy";
import { ConnectSourceEmpty } from "@/components/ConnectSourceEmpty";
import { DetailPlaceholder } from "@/components/DetailPaneBody";
import { ExternalTextLink } from "@/components/ExternalTextLink";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PrFilterBar } from "./PrFilterBar";

interface PrListProps {
  rows: PrRow[];
  selectedKey: string | null;
  narrow: boolean;
  connected: boolean;
  partial: boolean;
  emptyText: string;
  filters: PrFilters;
  authors: string[];
  repos: string[];
  reviewingKey: string | null;
  onFiltersChange: (filters: PrFilters) => void;
  onSelect: (row: PrRow) => void;
  onReview: (row: PrRow) => void;
  onOpenSettings: () => void;
}

export function PrList({
  rows,
  selectedKey,
  narrow,
  connected,
  partial,
  emptyText,
  filters,
  authors,
  repos,
  reviewingKey,
  onFiltersChange,
  onSelect,
  onReview,
  onOpenSettings,
}: PrListProps) {
  function handleClick(event: MouseEvent<HTMLElement>, row: PrRow) {
    if ((event.target as HTMLElement).closest("a, button")) return;
    onSelect(row);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>, row: PrRow) {
    if (event.target !== event.currentTarget) return;
    if (event.repeat) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onSelect(row);
  }

  return (
    <>
      <PrFilterBar
        filters={filters}
        authors={authors}
        repos={repos}
        onChange={onFiltersChange}
      />
      {partial && (
        <div className="px-4 py-2 text-sm font-semibold text-muted-foreground">
          Some pull requests may be missing: GitHub returned more than 100
          results in a search, or an organization needs SAML single sign-on.
        </div>
      )}
      <div className="scroll-stable-y min-h-0 flex-1 overflow-y-auto">
        {!connected ? (
          <ConnectSourceEmpty
            testId="pr-connect"
            description="GitHub is not connected. Connect it in Settings and the pull requests that wait on you land here."
            onOpenSettings={onOpenSettings}
          />
        ) : rows.length === 0 ? (
          <DetailPlaceholder>{emptyText}</DetailPlaceholder>
        ) : (
          <Table data-testid="pr-table">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead scope="col">#</TableHead>
                <TableHead scope="col">Title</TableHead>
                {!narrow && <TableHead scope="col">Author</TableHead>}
                {!narrow && <TableHead scope="col">Repository</TableHead>}
                <TableHead scope="col">State</TableHead>
                {!narrow && <TableHead scope="col">Checks</TableHead>}
                {!narrow && <TableHead scope="col">Age</TableHead>}
                {!narrow && <TableHead scope="col">Linked card</TableHead>}
                {!narrow && (
                  <TableHead scope="col">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow
                  key={row.key}
                  id={`pr-row-${row.key}`}
                  tabIndex={0}
                  aria-current={row.key === selectedKey ? "true" : undefined}
                  className="cursor-pointer focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring aria-[current=true]:bg-card"
                  onClick={(event) => handleClick(event, row)}
                  onKeyDown={(event) => handleKeyDown(event, row)}
                >
                  <TableCell>
                    <ExternalTextLink href={row.url}>
                      {`#${row.number}`}
                    </ExternalTextLink>
                  </TableCell>
                  <TableCell
                    className={
                      row.unread
                        ? "max-w-0 min-w-24 truncate font-semibold"
                        : "max-w-0 min-w-24 truncate"
                    }
                  >
                    {row.title}
                  </TableCell>
                  {!narrow && <TableCell>{row.author}</TableCell>}
                  {!narrow && <TableCell>{row.repo}</TableCell>}
                  <TableCell>
                    <Badge tone={STATE_TONE[row.state]}>{row.state}</Badge>
                  </TableCell>
                  {!narrow && (
                    <TableCell>
                      {row.checks !== "" && (
                        <Badge tone={CHECK_TONE[row.checks]}>
                          {row.checks}
                        </Badge>
                      )}
                    </TableCell>
                  )}
                  {!narrow && (
                    <TableCell>{formatAge(row.createdAt, nowMs())}</TableCell>
                  )}
                  {!narrow && <TableCell>{row.cardId ?? ""}</TableCell>}
                  {!narrow && (
                    <TableCell>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={reviewingKey !== null}
                        aria-label={`Review #${row.number}`}
                        onClick={() => onReview(row)}
                      >
                        Review
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </>
  );
}
