import {
  formatElapsed,
  sessionStatusLabel,
  type SessionRow as SessionRowModel,
} from "../../../../shared/sessions.js";
import { formatAge } from "../../../../shared/format-age.js";
import type {
  SessionAccountView,
  SessionNote,
} from "../../../../shared/session-account-view.js";
import {
  PR_CHIP_CAP,
  PrOverflowChip,
} from "@/components/badges/PrOverflowChip";
import { SessionAccountLabel } from "@/components/badges/SessionAccountLabel";
import { SessionNoteText } from "@/components/badges/SessionNoteText";
import { StaleBadge } from "@/components/badges/StaleBadge";
import { PrBadge } from "@/components/badges/PrBadge";
import { PreviewBadge } from "@/components/badges/PreviewBadge";
import { Badge } from "@/components/ui/badge";
import { SessionRestartButton } from "@/components/SessionRestartButton";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { cn } from "@/lib/utils";

interface SessionRowProps {
  row: SessionRowModel;
  account: SessionAccountView | null;
  pending: boolean;
  disabled: boolean;
  note: SessionNote | undefined;
  onRestart: () => void;
  now: number;
  selected: boolean;
  checked: boolean;
  narrow: boolean;
  onSelect: (row: SessionRowModel) => void;
  onToggleChecked: (row: SessionRowModel) => void;
}

const MARKER_MAX = 60;

const TONE: Partial<
  Record<
    ReturnType<typeof sessionStatusLabel>,
    "neutral" | "accent" | "success" | "warning" | "danger"
  >
> = {
  Working: "accent",
  "Needs you": "warning",
  Lost: "danger",
  Done: "success",
};

export function SessionRow({
  row,
  account,
  pending,
  disabled,
  note,
  onRestart,
  now,
  selected,
  checked,
  narrow,
  onSelect,
  onToggleChecked,
}: SessionRowProps) {
  const status = sessionStatusLabel(row);
  const snippet = [
    row.shortId,
    row.playbook ?? "no playbook",
    ...(account == null && row.account == null ? ["no account"] : []),
    `started ${formatAge(row.startedAt, now)}`,
    `${row.running ? "running" : "ran for"} ${formatElapsed(row.elapsedMs)}`,
  ].join(" · ");
  const marker =
    row.lastMarker == null
      ? null
      : row.lastMarker.length > MARKER_MAX
        ? `${row.lastMarker.slice(0, MARKER_MAX)}…`
        : row.lastMarker;

  return (
    <Item
      id={`session-row-${row.key}`}
      role="listitem"
      tabIndex={0}
      size="sm"
      selected={selected}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "cursor-pointer flex-nowrap gap-2 rounded-none px-4 py-2 focus-visible:-outline-offset-2",
        !selected && "border-b-border hover:bg-accent",
      )}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("[data-row-action]")) return;
        onSelect(row);
      }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget || event.repeat) return;
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onSelect(row);
      }}
    >
      <ItemMedia className="group-has-[[data-slot=item-description]]/item:translate-y-0 group-has-[[data-slot=item-description]]/item:self-center">
        <Badge tone={TONE[status] ?? "neutral"} className="border-0">
          {status}
        </Badge>
      </ItemMedia>
      <ItemContent className="min-w-0 gap-0.5">
        <ItemTitle className="block w-full truncate text-base font-normal">
          <span className="mr-2 inline-block min-w-16 font-mono text-xs font-semibold text-muted-foreground">
            {row.identifier}
          </span>
          {row.title}
        </ItemTitle>
        <ItemDescription className="leading-(--line-label) text-wrap break-words">
          {snippet}
        </ItemDescription>
        {(account != null || note) && (
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {account != null && <SessionAccountLabel name={account.name} />}
            {account?.stale && <StaleBadge />}
            {account?.pendingNote !== undefined && (
              <span
                className="min-w-0 text-xs break-words text-muted-foreground"
                data-testid="session-pending"
              >
                {account.pendingNote}
              </span>
            )}
            {note && <SessionNoteText note={note} />}
          </div>
        )}
      </ItemContent>
      <ItemActions className="shrink-0">
        {account?.stale && (
          <span data-row-action className="inline-flex">
            <SessionRestartButton
              pending={pending}
              disabled={disabled}
              label={`Restart session ${row.shortId}`}
              onRestart={onRestart}
            />
          </span>
        )}
        {row.cleaningUp ? <Badge tone="accent">Cleaning up</Badge> : null}
        {row.cleanupBlocked.length > 0 ? (
          <Badge
            tone="danger"
            title={row.cleanupBlocked
              .map((b) => `${b.repo}: ${b.count} uncommitted`)
              .join(", ")}
          >
            Cleanup blocked
          </Badge>
        ) : null}
        {row.worktree && !narrow ? (
          <Badge tone="neutral" className="max-w-50">
            <span className="truncate">{row.worktree}</span>
          </Badge>
        ) : null}
        {row.prs.slice(0, PR_CHIP_CAP).map((pr) => (
          <PrBadge key={pr.url} pr={pr} />
        ))}
        {row.prs.length > PR_CHIP_CAP ? (
          <PrOverflowChip hidden={row.prs.length - PR_CHIP_CAP} />
        ) : null}
        {row.previews.map((preview) => (
          <PreviewBadge key={preview.url} preview={preview} />
        ))}
        {marker && !narrow ? (
          <span
            className="max-w-55 truncate font-mono text-xs text-muted-foreground"
            title={row.lastMarker}
          >
            {marker}
          </span>
        ) : null}
        <Checkbox
          className="size-3.25"
          aria-label={`Select ${row.identifier} session ${row.shortId}`}
          checked={checked}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onCheckedChange={() => onToggleChecked(row)}
        />
      </ItemActions>
    </Item>
  );
}
