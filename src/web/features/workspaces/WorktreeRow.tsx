import type { CSSProperties, MouseEvent } from "react";
import { Code2, Trash2 } from "lucide-react";
import type { WorktreeRow as WorktreeRowModel } from "../../../shared/types.js";
import { COLUMN_LABELS } from "../../lib/event-copy.js";
import { formatAge } from "../../../shared/format-age.js";
import { formatCleanupCountdown } from "../../lib/format-cleanup-countdown.js";
import { formatSize } from "../../lib/format-size.js";
import type { WorktreeActions } from "./workspace-rows.js";
import { Chip } from "../../primitives/Chip.js";
import { Field } from "../../primitives/Field.js";
import { IconButton } from "../../primitives/IconButton.js";
import { ListRow } from "../../primitives/ListRow.js";

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

function stop(run: () => void) {
  return (event: MouseEvent) => {
    event.stopPropagation();
    run();
  };
}

const metaTextStyle: CSSProperties = {
  fontSize: "var(--font-micro)",
  color: "var(--text-muted)",
  whiteSpace: "nowrap",
};

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
  return (
    <ListRow
      id={`worktree-${row.sessionId}`}
      leading={<Chip>{COLUMN_LABELS[row.column]}</Chip>}
      title={
        <>
          <Field mono style={{ marginRight: "var(--space-xs)" }}>
            {row.identifier}
          </Field>
          {row.title}
        </>
      }
      snippet={snippet}
      meta={
        <>
          {row.blocked.length > 0 && (
            <Chip
              tone="danger"
              title={row.blocked
                .map((b) => `${b.repo}: ${b.count} uncommitted`)
                .join(", ")}
            >
              Blocked
            </Chip>
          )}
          {row.lost && <Chip tone="danger">Lost</Chip>}
          {!narrow && (
            <>
              <span style={metaTextStyle}>{size}</span>
              <span style={metaTextStyle}>{age}</span>
              <span style={metaTextStyle}>{due}</span>
            </>
          )}
          {actions.editor && (
            <IconButton
              aria-label={EDITOR_LABEL[actions.editor]}
              title={EDITOR_LABEL[actions.editor]}
              onClick={stop(onOpenEditor)}
            >
              <Code2 size={14} strokeWidth={2} aria-hidden="true" />
            </IconButton>
          )}
          {actions.cleanup && (
            <IconButton
              aria-label="Clean up now"
              title="Clean up now"
              onClick={stop(onCleanup)}
            >
              <Trash2 size={14} strokeWidth={2} aria-hidden="true" />
            </IconButton>
          )}
        </>
      }
      selected={false}
      unread={false}
      onSelect={onSelect}
    />
  );
}
