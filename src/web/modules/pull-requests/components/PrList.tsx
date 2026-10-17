import type { ReactNode } from "react";
import type {
  PrFilters,
  PrRow as PrRowData,
} from "../../../../shared/pr-rows.js";
import { ConnectSourceEmpty } from "@/components/ConnectSourceEmpty";
import { ListGroup } from "@/components/ListGroup";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ItemGroup } from "@/components/ui/item";
import type { PrEmptyState } from "@/modules/pull-requests/domain/pr-list-copy";
import type {
  PrGroup,
  PrGroupBy,
} from "@/modules/pull-requests/domain/pr-list-rows";
import { PrEmpty } from "./PrEmpty";
import { PrFilterBar } from "./PrFilterBar";
import { PrListScroll } from "./PrListScroll";

interface PrListProps {
  id: string;
  groups: PrGroup[];
  rows: readonly PrRowData[];
  groupBy: PrGroupBy;
  connected: boolean;
  partial: boolean;
  empty: PrEmptyState;
  filters: PrFilters;
  authors: string[];
  repos: string[];
  renderRow: (row: PrRowData) => ReactNode;
  onFiltersChange: (filters: PrFilters) => void;
  onGroupByChange: (groupBy: PrGroupBy) => void;
  onClearFilters: () => void;
  onOpenSettings: () => void;
}

export function PrList({
  id,
  groups,
  rows,
  groupBy,
  connected,
  partial,
  empty,
  filters,
  authors,
  repos,
  renderRow,
  onFiltersChange,
  onGroupByChange,
  onClearFilters,
  onOpenSettings,
}: PrListProps) {
  return (
    <div id={id} className="flex min-h-0 flex-1 flex-col">
      <PrFilterBar
        filters={filters}
        authors={authors}
        repos={repos}
        groupBy={groupBy}
        onChange={onFiltersChange}
        onGroupByChange={onGroupByChange}
      />
      {partial && (
        <Alert variant="muted" role="status" className="px-4 py-2">
          <AlertDescription className="font-semibold">
            Some pull requests may be missing: GitHub returned more than 100
            results in a search, or an organization needs SAML single sign-on.
          </AlertDescription>
        </Alert>
      )}
      <PrListScroll>
        {!connected ? (
          <ConnectSourceEmpty
            testId="pr-connect"
            description="GitHub is not connected. Connect it in Settings and the pull requests that wait on you land here."
            onOpenSettings={onOpenSettings}
          />
        ) : rows.length === 0 ? (
          <PrEmpty
            title={empty.title}
            description={empty.description}
            actions={
              empty.kind === "filtered" ? (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={onClearFilters}
                >
                  Clear filters
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div data-testid="pr-table">
            {groupBy === "none" ? (
              <ItemGroup>{rows.map(renderRow)}</ItemGroup>
            ) : (
              groups.map((group) => (
                <ListGroup
                  key={group.key}
                  title={group.label}
                  count={group.rows.length}
                  testId="pr-group"
                >
                  {group.rows.map(renderRow)}
                </ListGroup>
              ))
            )}
          </div>
        )}
      </PrListScroll>
    </div>
  );
}
