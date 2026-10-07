import type { KeyboardEvent } from "react";
import { Code2, Trash2 } from "lucide-react";
import type { WorktreeRow as WorktreeRowModel } from "../../../../shared/types.js";
import { COLUMN_LABELS } from "../../../../shared/column-labels.js";
import { formatAge } from "../../../../shared/format-age.js";
import { formatCleanupCountdown } from "../../../../shared/format-cleanup-countdown.js";
import { formatSize } from "../../../../shared/format-size.js";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { withoutBubbling } from "@/components/without-bubbling";
import { Item, ItemActions, ItemContent } from "@/components/ui/item";
import type { WorktreeActions } from "@/modules/workspaces/domain/workspace-rows";

interface WorktreeRowProps {
  row: WorktreeRowModel;
  now: number;
  narrow: boolean;
  actions: WorktreeActions;
  onSelect: () => void;
  onOpenEditor: () => void;
  onCleanup: () => void;
}

const EDITOR_LABEL = { code: "Open in VS Code", cursor: "Open in Cursor" };

export function WorktreeRow({
  row,
  now,
  narrow,
  actions,
  onSelect,
  onOpenEditor,
  onCleanup,
}: WorktreeRowProps) {
  const age =
    row.lastCommitAt === null
      ? "no commits read"
      : `committed ${formatAge(new Date(row.lastCommitAt).toISOString(), now)}`;
  const due =
    row.column !== "done"
      ? "when Done"
      : row.cleanupDueAt === null
        ? "not scheduled"
        : formatCleanupCountdown(row.cleanupDueAt, now);
  const size = formatSize(row.sizeKb);
  const snippet = (
    narrow
      ? [size, due, age, row.branch ?? "no branch", row.repos.join(", ")]
      : [row.branch ?? "no branch", row.repos.join(", ")]
  )
    .filter((part) => part !== "")
    .join(" · ");

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    if (event.repeat) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onSelect();
  }

  return (
    <Item
      id={`worktree-${row.sessionId}`}
      role="listitem"
      tabIndex={0}
      size="sm"
      className="cursor-pointer flex-nowrap gap-2 rounded-none border-b-border p-2 hover:bg-accent"
      onClick={onSelect}
      onKeyDown={handleKeyDown}
    >
      <Badge tone="neutral">{COLUMN_LABELS[row.column]}</Badge>
      <ItemContent className="min-w-0 gap-0.5">
        <span className="truncate text-base text-foreground">
          <span className="mr-1 font-mono text-xs font-semibold text-muted-foreground">
            {row.identifier}
          </span>
          {row.title}
        </span>
        {snippet && (
          <span className="line-clamp-2 text-sm break-words text-muted-foreground">
            {snippet}
          </span>
        )}
      </ItemContent>
      <ItemActions className="shrink-0">
        {row.blocked.length > 0 && (
          <Badge
            tone="danger"
            title={row.blocked
              .map((b) => `${b.repo}: ${b.count} uncommitted`)
              .join(", ")}
          >
            Blocked
          </Badge>
        )}
        {row.lost && <Badge tone="danger">Lost</Badge>}
        {!narrow && (
          <>
            <span className="text-xs whitespace-nowrap text-muted-foreground">
              {size}
            </span>
            <span className="text-xs whitespace-nowrap text-muted-foreground">
              {age}
            </span>
            <span className="text-xs whitespace-nowrap text-muted-foreground">
              {due}
            </span>
          </>
        )}
        {actions.editor && (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={EDITOR_LABEL[actions.editor]}
            title={EDITOR_LABEL[actions.editor]}
            onClick={withoutBubbling(onOpenEditor)}
          >
            <Code2 aria-hidden="true" />
          </Button>
        )}
        {actions.cleanup && (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Clean up now"
            title="Clean up now"
            onClick={withoutBubbling(onCleanup)}
          >
            <Trash2 aria-hidden="true" />
          </Button>
        )}
      </ItemActions>
    </Item>
  );
}
