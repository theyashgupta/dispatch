import type { CSSProperties } from "react";
import {
  formatElapsed,
  sessionStatusLabel,
  type SessionRow as SessionRowModel,
} from "../../lib/sessions.js";
import { formatAge } from "../../lib/format-age.js";
import { Chip } from "../../primitives/Chip.js";
import { Field } from "../../primitives/Field.js";
import { ListRow } from "../../primitives/ListRow.js";
import {
  PR_CHIP_CAP,
  PrBadge,
  PrOverflowChip,
  PreviewBadge,
} from "../badges/index.js";

interface SessionRowProps {
  row: SessionRowModel;
  now: number;
  selected: boolean;
  checked: boolean;
  narrow: boolean;
  onSelect: (row: SessionRowModel) => void;
  onToggleChecked: (row: SessionRowModel) => void;
}

const MARKER_MAX = 60;

const markerStyle: CSSProperties = {
  maxWidth: "220px",
  fontFamily: "var(--font-mono)",
  fontSize: "var(--font-micro)",
  color: "var(--text-muted)",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

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
    row.account ?? "no account",
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
    <ListRow
      id={`session-row-${row.key}`}
      selected={selected}
      unread={false}
      onSelect={() => onSelect(row)}
      snippet={snippet}
      leading={<Chip tone={TONE[status] ?? "neutral"}>{status}</Chip>}
      title={
        <>
          <Field
            mono
            style={{
              display: "inline-block",
              minWidth: "64px",
              marginRight: "var(--space-sm)",
            }}
          >
            {row.identifier}
          </Field>
          {row.title}
        </>
      }
      meta={
        <>
          {row.cleaningUp ? <Chip tone="accent">Cleaning up</Chip> : null}
          {row.cleanupBlocked.length > 0 ? (
            <Chip
              tone="danger"
              title={row.cleanupBlocked
                .map((b) => `${b.repo}: ${b.count} uncommitted`)
                .join(", ")}
            >
              Cleanup blocked
            </Chip>
          ) : null}
          {row.worktree && !narrow ? (
            <Chip style={{ maxWidth: "200px" }}>{row.worktree}</Chip>
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
            <span style={markerStyle} title={row.lastMarker}>
              {marker}
            </span>
          ) : null}
          <input
            type="checkbox"
            aria-label={`Select ${row.identifier} session ${row.shortId}`}
            checked={checked}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
            onChange={() => onToggleChecked(row)}
            style={{ margin: 0, accentColor: "var(--accent)" }}
          />
        </>
      }
    />
  );
}
