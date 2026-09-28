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
            label="Some pull requests may be missing: GitHub returned more than 100 results in a search, or an organization needs SAML single sign-on."
          />
        ) : undefined
      }
    >
      {!connected ? (
        <ConnectPrompt testId="pr-connect">
          GitHub is not connected. Connect it in Settings and the pull requests
          that wait on you land here.
        </ConnectPrompt>
      ) : rows.length === 0 ? (
        <PaneEmpty>No pull requests wait on you.</PaneEmpty>
      ) : (
        <PrList
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
      <PrDetail
        key={selectedRow?.key ?? "none"}
        row={selectedRow}
        onBack={narrow ? () => onSelect(null) : undefined}
        onStartAgent={onStartAgent}
        onNotice={onNotice}
      />
    </DetailPane>
  );

  return (
    <SplitView
      narrow={narrow}
      showDetail={selectedRow != null}
      list={list}
      detail={detail}
    />
  );
}
