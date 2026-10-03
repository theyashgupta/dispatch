import { useEffect, useState, type CSSProperties } from "react";
import type {
  BoardSnapshot,
  WorktreeRow as WorktreeRowModel,
} from "../../../shared/types.js";
import { NARROW_QUERY, useMediaQuery } from "../../hooks/useMediaQuery.js";
import { useWorkspaces } from "../../hooks/useWorkspaces.js";
import {
  addWorkspaceFolder,
  openEditor,
  removeWorkspaceFolder,
} from "../../lib/api.js";
import { nowMs } from "../../../shared/format-age.js";
import { Button } from "../../primitives/Button.js";
import { Collapsible } from "../../primitives/Collapsible.js";
import { Notice } from "../../primitives/Notice.js";
import { PageBody } from "../../primitives/PageBody.js";
import { focusRing } from "../../primitives/focus-ring.js";
import { WorkspaceFolders, WorkspaceRepos } from "./WorkspaceFolders.js";
import { WorktreeRow } from "./WorktreeRow.js";
import {
  WORKTREE_SORT_LABELS,
  sortWorktreeRows,
  worktreeActions,
  type WorktreeSortKey,
} from "./workspace-rows.js";

export interface WorkspacesSummary {
  count: number;
  totalKb: number;
  unknownSizes: number;
}

interface WorkspacesPageProps {
  board: BoardSnapshot;
  onSummaryChange: (summary: WorkspacesSummary | undefined) => void;
  onOpenCard: (row: WorktreeRowModel) => void;
  onCleanupRequest: (row: WorktreeRowModel) => void;
}

const toolbarStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: "var(--space-sm)",
};

const selectStyle: CSSProperties = {
  height: "32px",
  padding: "0 var(--space-sm)",
  background: "var(--surface-card)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius)",
  color: "var(--text)",
  fontFamily: "var(--font-ui)",
  fontSize: "var(--font-label)",
  lineHeight: "var(--line-label)",
  outline: "none",
};

const listStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
};

const emptyStyle: CSSProperties = {
  fontSize: "var(--font-label)",
  color: "var(--text-muted)",
  padding: "var(--space-sm) 0",
};

export function WorkspacesPage({
  board,
  onSummaryChange,
  onOpenCard,
  onCleanupRequest,
}: WorkspacesPageProps) {
  const { inventory, loading, error, refresh, reload } = useWorkspaces(board);
  const narrow = useMediaQuery(NARROW_QUERY);
  const [sortKey, setSortKey] = useState<WorktreeSortKey>("due");
  const [selectFocused, setSelectFocused] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const rows = inventory ? sortWorktreeRows(inventory.worktrees, sortKey) : [];
  const repos = inventory ? inventory.folders.flatMap((f) => f.repos) : [];
  const now = nowMs();

  useEffect(() => {
    onSummaryChange(
      inventory === null
        ? undefined
        : {
            count: inventory.worktrees.length,
            totalKb: inventory.totalKb,
            unknownSizes: inventory.unknownSizes,
          },
    );
  }, [inventory, onSummaryChange]);

  useEffect(() => () => onSummaryChange(undefined), [onSummaryChange]);

  function handleOpenEditor(
    row: WorktreeRowModel,
    editor: "code" | "cursor",
  ): void {
    setActionError(null);
    openEditor(row.cardId, editor).catch((err: unknown) => {
      console.error("openEditor failed", err);
      setActionError(`Couldn't open ${row.identifier} in the editor.`);
    });
  }

  async function handleAddFolder(path: string): Promise<string | null> {
    try {
      const result = await addWorkspaceFolder(path);
      if (!result.ok) return result.error;
      reload();
      return null;
    } catch (err) {
      console.error("addWorkspaceFolder failed", err);
      return "Couldn't reach the server. Try again.";
    }
  }

  function handleRemoveFolder(path: string): void {
    setActionError(null);
    removeWorkspaceFolder(path)
      .then(reload)
      .catch((err: unknown) => {
        console.error("removeWorkspaceFolder failed", err);
        setActionError("Couldn't remove that folder.");
      });
  }

  return (
    <PageBody>
      <div style={toolbarStyle}>
        <select
          aria-label="Sort by"
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as WorktreeSortKey)}
          onFocus={(event) =>
            setSelectFocused(event.currentTarget.matches(":focus-visible"))
          }
          onBlur={() => setSelectFocused(false)}
          style={{ ...selectStyle, ...focusRing(selectFocused) }}
        >
          {(Object.keys(WORKTREE_SORT_LABELS) as WorktreeSortKey[]).map(
            (key) => (
              <option key={key} value={key}>
                {WORKTREE_SORT_LABELS[key]}
              </option>
            ),
          )}
        </select>
        <Button onClick={refresh} loading={loading}>
          Refresh
        </Button>
      </div>
      {error && (
        <Notice tone="destructive">
          Couldn't read the workspaces. Try Refresh.
        </Notice>
      )}
      {actionError && <Notice tone="destructive">{actionError}</Notice>}
      <Collapsible title="Worktrees" badge={rows.length} defaultOpen>
        {inventory === null ? (
          <div style={emptyStyle}>Reading worktrees…</div>
        ) : rows.length === 0 ? (
          <div style={emptyStyle}>No worktrees on disk.</div>
        ) : (
          <div role="list" style={listStyle}>
            {rows.map((row) => {
              const actions = worktreeActions(row, board.editors);
              return (
                <WorktreeRow
                  key={`${row.cardId}:${row.sessionId}`}
                  row={row}
                  now={now}
                  narrow={narrow}
                  actions={actions}
                  onSelect={() => onOpenCard(row)}
                  onOpenEditor={() => {
                    if (actions.editor) handleOpenEditor(row, actions.editor);
                  }}
                  onCleanup={() => onCleanupRequest(row)}
                />
              );
            })}
          </div>
        )}
      </Collapsible>
      <Collapsible
        title="Folders"
        badge={inventory?.folders.length ?? 0}
        defaultOpen
      >
        <WorkspaceFolders
          folders={inventory?.folders ?? []}
          onAdd={handleAddFolder}
          onRemove={handleRemoveFolder}
        />
      </Collapsible>
      <Collapsible title="Repos" badge={repos.length} defaultOpen>
        <WorkspaceRepos repos={repos} />
      </Collapsible>
    </PageBody>
  );
}
