import { useMemo, useState, type CSSProperties } from "react";
import type { BoardSnapshot, Item } from "../../../shared/types.js";
import { CAROUSEL_QUERY, useMediaQuery } from "../../hooks/useMediaQuery.js";
import { Button } from "../../primitives/Button.js";
import { Notice } from "../../primitives/Notice.js";
import { Select } from "../../primitives/Select.js";
import { PrDetail } from "./PrDetail.js";
import { PrList } from "./PrList.js";
import {
  buildPrRows,
  groupPrRows,
  type PrGroupBy,
  type PrRow,
} from "../../lib/pr-rows.js";

interface PullRequestsPageProps {
  board: BoardSnapshot;
  items: Item[];
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
  onMarkRead: (itemId: string) => void;
  onStartAgent: (row: PrRow, prompt: string) => void;
  onNotice: (text: string) => void;
}

const GROUP_LABEL: Record<PrGroupBy, string> = {
  repo: "Repo",
  author: "Author",
  type: "Type",
};

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

const toolbarStyle: CSSProperties = {
  flex: "0 0 auto",
  display: "flex",
  alignItems: "center",
  flexWrap: "wrap",
  gap: "var(--space-sm)",
  padding: "var(--space-sm) var(--space-lg)",
  borderBottom: "1px solid var(--border)",
  background: "var(--surface-column)",
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

export function PullRequestsPage({
  board,
  items,
  selectedKey,
  onSelect,
  onMarkRead,
  onStartAgent,
  onNotice,
}: PullRequestsPageProps) {
  const narrow = useMediaQuery(CAROUSEL_QUERY);
  const [groupBy, setGroupBy] = useState<PrGroupBy>("repo");
  const rows = useMemo(
    () => buildPrRows(items, board.cards),
    [items, board.cards],
  );
  const groups = useMemo(() => groupPrRows(rows, groupBy), [rows, groupBy]);
  const connected = board.enabledSources?.includes("github") === true;
  const partial = board.syncWarning?.startsWith("github ") === true;

  function handleSelect(row: PrRow) {
    onSelect(row.key);
    if (row.unread && row.itemId) onMarkRead(row.itemId);
  }

  const list = (
    <div
      style={
        narrow
          ? { ...listPaneStyle, flex: "1 1 auto", borderRight: "none" }
          : listPaneStyle
      }
    >
      <div style={toolbarStyle}>
        <Select
          label="Group by"
          value={groupBy}
          labels={GROUP_LABEL}
          onChange={setGroupBy}
        />
      </div>
      {partial && (
        <div style={{ padding: "var(--space-sm) var(--space-lg)" }}>
          <Notice
            tone="muted"
            label="Some pull requests may be missing: GitHub returned more than 100 results in a search, or an organization needs SAML single sign-on."
          />
        </div>
      )}
      <div className="scroll-stable-y" style={scrollStyle}>
        {!connected ? (
          <div style={emptyStyle} data-testid="pr-connect">
            <Notice
              tone="muted"
              label="Connect a source"
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
            >
              GitHub is not connected. Connect it in Settings and the pull
              requests that wait on you land here.
            </Notice>
          </div>
        ) : rows.length === 0 ? (
          <div style={emptyStyle}>No pull requests wait on you.</div>
        ) : (
          <PrList
            groups={groups}
            selectedKey={selectedKey}
            onSelect={handleSelect}
          />
        )}
      </div>
    </div>
  );

  const selectedRow = connected
    ? (rows.find((row) => row.key === selectedKey) ?? null)
    : null;
  const detail = (
    <div style={detailPaneStyle}>
      <PrDetail
        key={selectedRow?.key ?? "none"}
        row={selectedRow}
        onBack={narrow ? () => onSelect(null) : undefined}
        onStartAgent={onStartAgent}
        onNotice={onNotice}
      />
    </div>
  );

  if (narrow) return <div style={pageStyle}>{selectedRow ? detail : list}</div>;
  return (
    <div style={pageStyle}>
      {list}
      {detail}
    </div>
  );
}
