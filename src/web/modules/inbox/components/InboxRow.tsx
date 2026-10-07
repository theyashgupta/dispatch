import type { ReactNode } from "react";
import { ArrowUp, MoreHorizontal } from "lucide-react";
import {
  actionsFor,
  type InboxAction,
  type InboxActionId,
  type InboxRowModel,
} from "../../../../shared/item-actions.js";
import { formatAge, nowMs } from "../../../../shared/format-age.js";
import type { SnoozePreset } from "../../../../shared/snooze.js";
import { SourceBadge } from "@/components/badges/SourceBadge";
import { PRIORITY_DOT } from "@/components/badges/priority-dot";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { cn } from "@/lib/utils";
import { InboxMenu } from "./InboxMenu";
import { SnoozeMenu } from "./SnoozeMenu";
import { inboxRowDomId } from "@/modules/inbox/domain/inbox-ids";
import { priorityDotKey } from "@/modules/inbox/domain/inbox-rows";

export type InboxMenuKind = "menu" | "snooze";

export interface SlackThreadSlotArgs {
  itemId: string;
  replyCount?: string;
}

interface InboxRowProps {
  row: InboxRowModel;
  selected: boolean;
  iconOnly: boolean;
  expanded: boolean;
  menuKind: InboxMenuKind | null;
  onSelect: (row: InboxRowModel) => void;
  onMenuOpenChange: (rowId: string, kind: InboxMenuKind, open: boolean) => void;
  onAction: (row: InboxRowModel, actionId: InboxActionId) => void;
  onPickAction: (row: InboxRowModel, action: InboxAction) => void;
  onPickSnooze: (row: InboxRowModel, preset: SnoozePreset) => void;
  renderSlackThread?: (args: SlackThreadSlotArgs) => ReactNode;
}

export function InboxRow({
  row,
  selected,
  iconOnly,
  expanded,
  menuKind,
  onSelect,
  onMenuOpenChange,
  onAction,
  onPickAction,
  onPickSnooze,
  renderSlackThread,
}: InboxRowProps) {
  const dotKey = priorityDotKey(row.priority);
  const priorityDot = dotKey == null ? undefined : PRIORITY_DOT[dotKey];
  const meta = row.item?.meta ?? {};
  const kind = menuKind ?? "menu";

  return (
    <DropdownMenu
      modal={false}
      open={menuKind != null}
      onOpenChange={(open) => onMenuOpenChange(row.id, kind, open)}
    >
      <Item
        id={inboxRowDomId(row.id)}
        role="listitem"
        tabIndex={0}
        size="sm"
        selected={selected}
        aria-current={selected ? "true" : undefined}
        className={cn(
          "cursor-pointer flex-nowrap gap-2 rounded-none px-4 py-2 focus-visible:outline-offset-0",
          !selected && "border-b-border hover:bg-accent",
        )}
        onClick={() => onSelect(row)}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget || event.repeat) return;
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          onSelect(row);
        }}
      >
        <ItemMedia className="gap-1 group-has-[[data-slot=item-description]]/item:translate-y-0 group-has-[[data-slot=item-description]]/item:self-center">
          <SourceBadge source={row.source} />
          {priorityDot && (
            <Badge
              title={priorityDot.label}
              stateColor={priorityDot.color}
              className="size-1.5 rounded-full border-0 bg-(--badge-state) p-0"
            />
          )}
        </ItemMedia>
        <ItemContent className="min-w-0 gap-0.5">
          <ItemTitle
            className={cn(
              "block w-full truncate text-base",
              row.unread ? "font-semibold" : "font-normal",
            )}
          >
            {row.kind === "card" || !iconOnly ? (
              <span className="mr-2 inline-block min-w-16 font-mono text-xs font-semibold text-muted-foreground">
                {row.kind === "card" ? row.card?.identifier : row.typeLabel}
              </span>
            ) : null}
            {row.title}
          </ItemTitle>
          {row.snippet ? (
            <ItemDescription className="leading-(--line-label) text-wrap break-words">
              {row.snippet}
            </ItemDescription>
          ) : null}
        </ItemContent>
        {row.unread ? (
          <Badge
            aria-hidden="true"
            className="size-1.5 rounded-full border-0 bg-primary p-0"
          />
        ) : null}
        <ItemActions className="shrink-0">
          {!iconOnly && row.project ? (
            <Badge tone="neutral" className="max-w-35">
              <span className="truncate">{row.project}</span>
            </Badge>
          ) : null}
          <span className="w-12 shrink-0 text-right text-sm text-muted-foreground">
            {formatAge(row.time, nowMs())}
          </span>
          <Button
            variant="secondary"
            size={iconOnly ? "icon-compact" : "sm"}
            aria-label={iconOnly ? "Promote" : undefined}
            onClick={(event) => {
              event.stopPropagation();
              onAction(row, "promote");
            }}
          >
            <ArrowUp className="size-3" strokeWidth={2} aria-hidden="true" />
            {!iconOnly && "Promote"}
          </Button>
          <DropdownMenuTrigger asChild>
            <Button
              variant="secondary"
              size="icon-compact"
              aria-label="Row actions"
              onClick={(event) => event.stopPropagation()}
            >
              <MoreHorizontal
                className="size-3"
                strokeWidth={2}
                aria-hidden="true"
              />
            </Button>
          </DropdownMenuTrigger>
        </ItemActions>
      </Item>
      {menuKind === "menu" ? (
        <InboxMenu row={row} onPick={(action) => onPickAction(row, action)} />
      ) : null}
      {menuKind === "snooze" ? (
        <SnoozeMenu onPick={(preset) => onPickSnooze(row, preset)} />
      ) : null}
      {expanded && row.kind === "item" ? (
        <div
          data-testid="inbox-row-expanded"
          className="flex flex-col gap-2 border-b border-border bg-card pt-2 pr-4 pb-4 pl-14"
        >
          {row.snippet ? (
            <div className="text-sm break-words whitespace-pre-wrap text-foreground">
              {row.snippet}
            </div>
          ) : null}
          {Object.keys(meta).length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {Object.entries(meta).map(([k, v]) => (
                <Badge key={k} tone="neutral" title={k}>
                  {k}: {v}
                </Badge>
              ))}
            </div>
          ) : null}
          {row.item?.source === "slack" && meta.threadTs
            ? renderSlackThread?.({
                itemId: row.id,
                replyCount: meta.replyCount,
              })
            : null}
          <div className="flex flex-wrap gap-1">
            {actionsFor(row).map((action) => (
              <Button
                key={action.id}
                variant="secondary"
                size="sm"
                onClick={() => onAction(row, action.id)}
              >
                {action.label}
              </Button>
            ))}
          </div>
        </div>
      ) : null}
    </DropdownMenu>
  );
}
