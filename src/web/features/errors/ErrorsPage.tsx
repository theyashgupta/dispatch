import { useMemo, useState } from "react";
import type { BoardSnapshot, Item } from "../../../shared/types.js";
import { CAROUSEL_QUERY, useMediaQuery } from "../../hooks/useMediaQuery.js";
import { Notice } from "../../primitives/Notice.js";
import { Select } from "../../primitives/Select.js";
import {
  DetailPane,
  ConnectPrompt,
  PaneEmpty,
  ListPane,
  SplitView,
} from "../../primitives/SplitView.js";
import { ErrorDetail } from "./ErrorDetail.js";
import { ErrorList } from "./ErrorList.js";
import {
  buildErrorRows,
  groupErrorRows,
  type ErrorGroupBy,
  type ErrorRow,
} from "./error-rows.js";

interface ErrorsPageProps {
  board: BoardSnapshot;
  items: Item[];
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
  onMarkRead: (itemId: string) => void;
  onStartAgent: (row: ErrorRow, prompt: string, context: string) => void;
  onNotice: (text: string) => void;
}

const GROUP_LABEL: Record<ErrorGroupBy, string> = {
  project: "Project",
  level: "Level",
};

export function ErrorsPage({
  board,
  items,
  selectedKey,
  onSelect,
  onMarkRead,
  onStartAgent,
  onNotice,
}: ErrorsPageProps) {
  const narrow = useMediaQuery(CAROUSEL_QUERY);
  const [groupBy, setGroupBy] = useState<ErrorGroupBy>("project");
  const rows = useMemo(() => buildErrorRows(items), [items]);
  const groups = useMemo(() => groupErrorRows(rows, groupBy), [rows, groupBy]);
  const connected = board.enabledSources?.includes("sentry") === true;
  const partial = board.syncWarning?.startsWith("sentry ") === true;

  function handleSelect(row: ErrorRow) {
    onSelect(row.key);
    if (row.unread) onMarkRead(row.itemId);
  }

  const list = (
    <ListPane
      narrow={narrow}
      toolbar={
        <Select
          label="Group by"
          value={groupBy}
          labels={GROUP_LABEL}
          onChange={setGroupBy}
        />
      }
      notice={
        partial ? (
          <Notice
            tone="muted"
            label="Some errors may be missing: Sentry returned 100 or more issues in a query, more than 10 organizations, or an organization refused access."
          />
        ) : undefined
      }
    >
      {!connected ? (
        <ConnectPrompt testId="errors-connect">
          Sentry is not connected. Connect it in Settings and the errors that
          need you land here.
        </ConnectPrompt>
      ) : rows.length === 0 ? (
        <PaneEmpty>No errors need you.</PaneEmpty>
      ) : (
        <ErrorList
          groups={groups}
          selectedKey={selectedKey}
          onSelect={handleSelect}
        />
      )}
    </ListPane>
  );

  const selectedRow = connected
    ? (rows.find((row) => row.key === selectedKey) ?? null)
    : null;
  const detail = (
    <DetailPane>
      <ErrorDetail
        key={selectedRow?.key ?? "none"}
        row={selectedRow}
        placeholder={
          connected && rows.length > 0
            ? "Select an error to see its details."
            : null
        }
        onBack={narrow ? () => onSelect(null) : undefined}
        onStartAgent={onStartAgent}
        onNotice={onNotice}
      />
    </DetailPane>
  );

  return (
    <SplitView
      narrow={narrow}
      showDetail={selectedRow !== null}
      list={list}
      detail={detail}
    />
  );
}
