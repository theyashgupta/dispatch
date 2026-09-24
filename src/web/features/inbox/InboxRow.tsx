import { ArrowUp, MoreHorizontal } from "lucide-react";
import type { CSSProperties, MouseEvent } from "react";
import { useMediaQuery } from "../../hooks/useMediaQuery.js";
import {
  actionsFor,
  type InboxActionId,
  type InboxRowModel,
} from "../../lib/actions.js";
import { formatAge, nowMs } from "../../lib/format-age.js";
import { Button } from "../../primitives/Button.js";
import { Chip } from "../../primitives/Chip.js";
import { Field } from "../../primitives/Field.js";
import { ListRow } from "../../primitives/ListRow.js";
import { SourceBadge } from "../badges/index.js";
import { PRIORITY_DOT } from "../board/index.js";
import { priorityDotKey } from "./inbox-rows.js";

interface InboxRowProps {
  row: InboxRowModel;
  selected: boolean;
  expanded: boolean;
  onSelect: (row: InboxRowModel) => void;
  onOpenMenu: (row: InboxRowModel, anchor: DOMRect) => void;
  onAction: (row: InboxRowModel, actionId: InboxActionId) => void;
}

const EXPANDED_INSET = 56;

const expandedStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-sm)",
  padding: `var(--space-sm) var(--space-lg) var(--space-lg) ${EXPANDED_INSET}px`,
  borderBottom: "1px solid var(--border)",
  background: "var(--surface-card)",
};

const fullSnippetStyle: CSSProperties = {
  fontSize: "var(--font-label)",
  lineHeight: "var(--line-label)",
  color: "var(--text)",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
};

const metaListStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "var(--space-xs)",
};

const actionsStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "var(--space-xs)",
};

const timeStyle: CSSProperties = {
  flex: "0 0 48px",
  textAlign: "right",
  fontSize: "var(--font-label)",
  color: "var(--text-muted)",
};

function stop(event: MouseEvent) {
  event.stopPropagation();
}

export function InboxRow({
  row,
  selected,
  expanded,
  onSelect,
  onOpenMenu,
  onAction,
}: InboxRowProps) {
  const iconOnly = useMediaQuery("(max-width: 1023px)");
  const dotKey = priorityDotKey(row.priority);
  const priorityDot = dotKey == null ? undefined : PRIORITY_DOT[dotKey];
  const meta = row.item?.meta ?? {};

  return (
    <>
      <ListRow
        id={`inbox-row-${row.id}`}
        selected={selected}
        unread={row.unread}
        onSelect={() => onSelect(row)}
        snippet={row.snippet || undefined}
        leading={
          <>
            <SourceBadge source={row.source} />
            {priorityDot && (
              <span
                title={priorityDot.label}
                style={{
                  width: "6px",
                  height: "6px",
                  borderRadius: "50%",
                  background: priorityDot.color,
                  flex: "0 0 auto",
                }}
              />
            )}
          </>
        }
        title={
          <>
            {row.kind === "card" || !iconOnly ? (
              <Field
                mono
                style={{
                  display: "inline-block",
                  minWidth: "64px",
                  marginRight: "var(--space-sm)",
                }}
              >
                {row.kind === "card" ? row.card?.identifier : row.typeLabel}
              </Field>
            ) : null}
            {row.title}
          </>
        }
        meta={
          <>
            {!iconOnly && row.project ? (
              <Chip style={{ maxWidth: "140px" }}>{row.project}</Chip>
            ) : null}
            <span style={timeStyle}>{formatAge(row.time, nowMs())}</span>
            <Button
              variant="secondary"
              onPointerDown={stop}
              onClick={(event) => {
                event.stopPropagation();
                onAction(row, "promote");
              }}
              aria-label={iconOnly ? "Promote" : undefined}
            >
              <ArrowUp size={12} strokeWidth={2} aria-hidden="true" />
              {!iconOnly && "Promote"}
            </Button>
            <Button
              variant="secondary"
              aria-label="Row actions"
              aria-haspopup="menu"
              onPointerDown={stop}
              onClick={(event) => {
                event.stopPropagation();
                onOpenMenu(row, event.currentTarget.getBoundingClientRect());
              }}
            >
              <MoreHorizontal size={12} strokeWidth={2} aria-hidden="true" />
            </Button>
          </>
        }
      />
      {expanded && row.kind === "item" ? (
        <div style={expandedStyle} data-testid="inbox-row-expanded">
          {row.snippet ? (
            <div style={fullSnippetStyle}>{row.snippet}</div>
          ) : null}
          {Object.keys(meta).length > 0 ? (
            <div style={metaListStyle}>
              {Object.entries(meta).map(([k, v]) => (
                <Chip key={k} title={k}>
                  {k}: {v}
                </Chip>
              ))}
            </div>
          ) : null}
          <div style={actionsStyle}>
            {actionsFor(row).map((action) => (
              <Button
                key={action.id}
                variant="secondary"
                onClick={() => onAction(row, action.id)}
              >
                {action.label}
              </Button>
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}
