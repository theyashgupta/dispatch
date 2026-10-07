import type { ReactNode } from "react";
import type {
  InboxActionId,
  InboxAction,
  InboxRowModel,
} from "../../../../shared/item-actions.js";
import type { SnoozePreset } from "../../../../shared/snooze.js";
import { GroupCollapsible } from "@/components/GroupCollapsible";
import { Glyph } from "@/components/icons/Glyph";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { useMediaQuery } from "@/components/ui/hooks/use-media-query";
import {
  InboxRow,
  type InboxMenuKind,
  type SlackThreadSlotArgs,
} from "./InboxRow";
import { CAROUSEL_QUERY } from "../../../../shared/media-queries.js";
import type {
  InboxGroup,
  InboxGroupBy,
} from "@/modules/inbox/domain/inbox-rows";

export interface InboxOpenMenu {
  kind: InboxMenuKind;
  rowId: string;
}

interface InboxListProps {
  totalCount: number;
  visibleRows: InboxRowModel[];
  groups: InboxGroup[];
  groupBy: InboxGroupBy;
  noSource: boolean;
  cursorId: string | undefined;
  selectedCardId: string | null;
  expandedId: string | null;
  openMenu: InboxOpenMenu | null;
  onSelect: (row: InboxRowModel) => void;
  onMenuOpenChange: (rowId: string, kind: InboxMenuKind, open: boolean) => void;
  onAction: (row: InboxRowModel, actionId: InboxActionId) => void;
  onPickAction: (row: InboxRowModel, action: InboxAction) => void;
  onPickSnooze: (row: InboxRowModel, preset: SnoozePreset) => void;
  onClearFilters: () => void;
  onOpenSettings: () => void;
  renderSlackThread?: (args: SlackThreadSlotArgs) => ReactNode;
}

export function InboxList({
  totalCount,
  visibleRows,
  groups,
  groupBy,
  noSource,
  cursorId,
  selectedCardId,
  expandedId,
  openMenu,
  onSelect,
  onMenuOpenChange,
  onAction,
  onPickAction,
  onPickSnooze,
  onClearFilters,
  onOpenSettings,
  renderSlackThread,
}: InboxListProps) {
  const iconOnly = useMediaQuery(CAROUSEL_QUERY);
  const renderRow = (row: InboxRowModel) => (
    <InboxRow
      key={row.id}
      row={row}
      selected={
        row.id === cursorId ||
        (row.kind === "card"
          ? row.id === selectedCardId
          : row.id === expandedId)
      }
      iconOnly={iconOnly}
      expanded={row.id === expandedId}
      menuKind={openMenu?.rowId === row.id ? openMenu.kind : null}
      onSelect={onSelect}
      onMenuOpenChange={onMenuOpenChange}
      onAction={onAction}
      onPickAction={onPickAction}
      onPickSnooze={onPickSnooze}
      renderSlackThread={renderSlackThread}
    />
  );

  return (
    <div
      role={visibleRows.length > 0 && groupBy === "none" ? "list" : undefined}
      className="scroll-stable-y min-h-0 flex-auto overflow-y-auto"
    >
      {totalCount === 0 && noSource ? (
        <div
          data-testid="inbox-connect"
          className="flex flex-col items-center gap-2 px-4 py-12 text-center"
        >
          <Alert variant="muted" className="justify-items-center text-center">
            <AlertTitle>Connect a source</AlertTitle>
            <AlertDescription className="justify-items-center">
              Nothing feeds this Inbox yet. Connect Linear or another source in
              Settings and new work lands here.
            </AlertDescription>
            <Button
              size="sm"
              className="col-start-2 justify-self-center"
              onClick={onOpenSettings}
            >
              Open Settings
            </Button>
          </Alert>
        </div>
      ) : totalCount === 0 ? (
        <Empty className="gap-2 p-12">
          <EmptyMedia>
            <Glyph size={48} className="opacity-8" />
          </EmptyMedia>
          <EmptyHeader className="max-w-none gap-2">
            <EmptyTitle className="text-base font-semibold">
              Inbox is empty
            </EmptyTitle>
            <EmptyDescription>
              New items and tickets you haven't triaged yet will show up here.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : visibleRows.length === 0 ? (
        <Empty className="gap-2 p-12">
          <EmptyHeader className="max-w-none gap-2">
            <EmptyTitle className="text-base font-semibold">
              No matching rows
            </EmptyTitle>
            <EmptyDescription>
              Try a different search or clear your filters.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="secondary" size="sm" onClick={onClearFilters}>
              Clear filters
            </Button>
          </EmptyContent>
        </Empty>
      ) : groupBy === "none" ? (
        visibleRows.map(renderRow)
      ) : (
        groups.map((group) => (
          <div key={group.key} className="px-4" data-testid="inbox-group">
            <GroupCollapsible label={group.label} count={group.rows.length}>
              <div role="list" className="-mx-4">
                {group.rows.map(renderRow)}
              </div>
            </GroupCollapsible>
          </div>
        ))
      )}
    </div>
  );
}
