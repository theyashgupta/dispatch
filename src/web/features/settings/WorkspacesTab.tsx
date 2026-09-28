import { useCallback, useEffect, useState } from "react";
import { FolderGit2, Trash2 } from "lucide-react";
import {
  addWorkspaceFolder,
  getWorkspaceFolders,
  removeWorkspaceFolder,
} from "../../lib/api.js";
import { IconButton } from "../../primitives/IconButton.js";
import { Notice } from "../../primitives/Notice.js";
import { WorkspaceAdd } from "../workspaces/index.js";

interface WorkspacesTab {
  folders: string[];
  loading: boolean;
  loadError: boolean;
  addFolder: (path: string) => Promise<string | null>;
  removeFolder: (path: string) => void;
}

export function useWorkspacesTab(): WorkspacesTab {
  const [folders, setFolders] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const { folders: fs } = await getWorkspaceFolders();
        if (!active) return;
        setFolders(fs);
      } catch (err) {
        console.error("getWorkspaceFolders failed", err);
        if (!active) return;
        setLoadError(true);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const addFolder = useCallback(
    async (path: string): Promise<string | null> => {
      try {
        const result = await addWorkspaceFolder(path);
        if (!result.ok) return result.error;
        setFolders((prev) => (prev.includes(path) ? prev : [...prev, path]));
        return null;
      } catch (err) {
        console.error("addWorkspaceFolder failed", err);
        return "Couldn't reach the server. Try again.";
      }
    },
    [],
  );

  const removeFolder = useCallback((path: string) => {
    removeWorkspaceFolder(path).catch((err) => {
      console.error("removeWorkspaceFolder failed", err);
    });
    setFolders((prev) => prev.filter((f) => f !== path));
  }, []);

  return { folders, loading, loadError, addFolder, removeFolder };
}

interface WorkspaceRowProps {
  path: string;
  onRemove: () => void;
}

function WorkspaceRow({ path, onRemove }: WorkspaceRowProps) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-sm)",
        padding: "var(--space-sm)",
        borderRadius: "var(--radius)",
        background: hover ? "var(--surface-card-hover)" : "transparent",
      }}
    >
      <FolderGit2
        size={14}
        strokeWidth={2}
        aria-hidden="true"
        style={{ color: "var(--text-muted)", flex: "0 0 auto" }}
      />
      <span
        style={{
          flex: "1 1 auto",
          minWidth: 0,
          fontFamily: "var(--font-mono)",
          fontSize: "var(--font-label)",
          fontWeight: "var(--weight-semibold)",
          lineHeight: "var(--line-label)",
          color: "var(--text)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {path}
      </span>
      <IconButton aria-label={`Remove workspace ${path}`} onClick={onRemove}>
        <Trash2 size={14} strokeWidth={2} aria-hidden="true" />
      </IconButton>
    </div>
  );
}

interface WorkspacesTabSectionProps {
  workspacesTab: WorkspacesTab;
}

export function WorkspacesTabSection({
  workspacesTab,
}: WorkspacesTabSectionProps) {
  const { folders, loading, loadError, addFolder, removeFolder } =
    workspacesTab;

  return (
    <div
      className="scroll-stable-y"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-lg)",
        flex: "1 1 auto",
        minHeight: 0,
        overflowY: "auto",
      }}
    >
      <WorkspaceAdd
        onAdd={addFolder}
        hint="Add a folder that contains the git repos you start tickets in."
      />

      {loading && (
        <span
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "var(--font-label)",
            fontWeight: "var(--weight-semibold)",
            lineHeight: "var(--line-label)",
            color: "var(--text-muted)",
          }}
        >
          Loading…
        </span>
      )}

      {!loading && loadError && (
        <Notice
          tone="destructive"
          label="Couldn't load workspaces. Reopen settings to retry."
        />
      )}

      {!loading && !loadError && folders.length === 0 && (
        <div style={{ marginTop: "var(--space-lg)" }}>
          <Notice tone="muted" label="No workspaces yet">
            Add a folder above to start tickets in it.
          </Notice>
        </div>
      )}

      {!loading && !loadError && folders.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {folders.map((f) => (
            <WorkspaceRow key={f} path={f} onRemove={() => removeFolder(f)} />
          ))}
        </div>
      )}
    </div>
  );
}
