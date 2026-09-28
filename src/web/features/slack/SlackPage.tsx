import { useEffect, useMemo, useRef, type CSSProperties } from "react";
import type { BoardSnapshot } from "../../../shared/types.js";
import { CAROUSEL_QUERY, useMediaQuery } from "../../hooks/useMediaQuery.js";
import type { ActionServices } from "../../lib/actions.js";
import { groupSlackRows, type SlackRow } from "../../lib/slack-rows.js";
import { Button } from "../../primitives/Button.js";
import { Notice } from "../../primitives/Notice.js";
import { SlackDetail } from "./SlackDetail.js";
import { SlackList } from "./SlackList.js";

interface SlackPageProps {
  board: BoardSnapshot;
  rows: SlackRow[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onMarkRead: (itemId: string) => void;
  services: ActionServices;
}

const pageStyle: CSSProperties = {
  display: "flex",
  flex: "1 1 auto",
  minHeight: 0,
  minWidth: 0,
};

const listPaneStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  flex: "0 0 480px",
  minWidth: 0,
  minHeight: 0,
  borderRight: "1px solid var(--border)",
};

const scrollStyle: CSSProperties = {
  flex: "1 1 auto",
  minHeight: 0,
  overflowY: "auto",
};

const detailPaneStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  flex: "1 1 auto",
  minWidth: 0,
  minHeight: 0,
};

const emptyStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-sm)",
  padding: "var(--space-3xl) var(--space-lg)",
  textAlign: "center",
  alignItems: "center",
  fontSize: "var(--font-label)",
  lineHeight: "var(--line-label)",
  color: "var(--text-muted)",
};

export function SlackPage({
  board,
  rows,
  selectedId,
  onSelect,
  onMarkRead,
  services,
}: SlackPageProps) {
  const narrow = useMediaQuery(CAROUSEL_QUERY);
  const enabled = board.enabledSources?.includes("slack") === true;
  const groups = useMemo(() => groupSlackRows(rows), [rows]);
  const selectedRow = rows.find((row) => row.id === selectedId) ?? null;
  const selectedRef = useRef(selectedId);
  useEffect(() => {
    selectedRef.current = selectedId;
  }, [selectedId]);
  const hasDetail = enabled && rows.length > 0;

  function handleSelect(row: SlackRow) {
    onSelect(row.id);
    if (row.unread) onMarkRead(row.id);
  }

  const list = (
    <div
      style={
        narrow || !hasDetail
          ? { ...listPaneStyle, flex: "1 1 auto", borderRight: "none" }
          : listPaneStyle
      }
    >
      <div className="scroll-stable-y" style={scrollStyle}>
        {!enabled ? (
          <div style={emptyStyle} data-testid="slack-off">
            <Notice
              tone="muted"
              label="Slack is off. Turn it on in Settings."
              action={
                <Button
                  variant="primary"
                  onClick={() => {
                    window.location.hash = "#/settings";
                  }}
                  style={{ alignSelf: "center" }}
                >
                  Open Settings
                </Button>
              }
            />
          </div>
        ) : rows.length === 0 ? (
          <div style={emptyStyle}>No Slack mentions or DMs yet.</div>
        ) : (
          <SlackList
            groups={groups}
            selectedId={selectedId}
            onSelect={handleSelect}
          />
        )}
      </div>
    </div>
  );

  const detail = (
    <div style={detailPaneStyle}>
      <SlackDetail
        key={selectedRow?.id ?? "none"}
        row={selectedRow}
        services={services}
        onBack={narrow ? () => onSelect(null) : undefined}
        onLeave={(id) => {
          if (selectedRef.current === id) onSelect(null);
        }}
      />
    </div>
  );

  if (narrow) return <div style={pageStyle}>{selectedRow ? detail : list}</div>;
  return (
    <div style={pageStyle}>
      {list}
      {hasDetail && detail}
    </div>
  );
}
