import type { CSSProperties } from "react";
import { FolderGit2, Trash2 } from "lucide-react";
import type { DiscoveredRepo } from "../../../shared/types.js";
import { Chip } from "../../primitives/Chip.js";
import { IconButton } from "../../primitives/IconButton.js";
import { WorkspaceAdd } from "./WorkspaceAdd.js";

interface WorkspaceReposProps {
  repos: DiscoveredRepo[];
}

interface WorkspaceFoldersProps {
  folders: { path: string; repos: DiscoveredRepo[] }[];
  onAdd: (path: string) => Promise<string | null>;
  onRemove: (path: string) => void;
}

const listStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-xs)",
  marginBottom: "var(--space-sm)",
};

const rowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-sm)",
  padding: "var(--space-xs) 0",
};

const nameStyle: CSSProperties = {
  flex: "0 0 auto",
  fontSize: "var(--font-body)",
  color: "var(--text)",
};

const pathStyle: CSSProperties = {
  flex: "1 1 auto",
  minWidth: 0,
  fontFamily: "var(--font-mono)",
  fontSize: "var(--font-micro)",
  color: "var(--text-muted)",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const countStyle: CSSProperties = {
  flex: "0 0 auto",
  fontSize: "var(--font-micro)",
  color: "var(--text-muted)",
};

function basename(folderPath: string): string {
  return folderPath.split("/").filter(Boolean).pop() ?? folderPath;
}

export function WorkspaceFolders({
  folders,
  onAdd,
  onRemove,
}: WorkspaceFoldersProps) {
  return (
    <>
      <div role="list" style={listStyle}>
        {folders.map((folder) => (
          <div key={folder.path} role="listitem" style={rowStyle}>
            <FolderGit2
              size={14}
              strokeWidth={2}
              aria-hidden="true"
              style={{ color: "var(--text-muted)", flex: "0 0 auto" }}
            />
            <span style={nameStyle}>{basename(folder.path)}</span>
            <span style={pathStyle} title={folder.path}>
              {folder.path}
            </span>
            <span style={countStyle}>
              {folder.repos.length === 1
                ? "1 repo"
                : `${folder.repos.length} repos`}
            </span>
            <IconButton
              aria-label={`Remove ${folder.path}`}
              title="Remove folder"
              onClick={() => onRemove(folder.path)}
            >
              <Trash2 size={14} strokeWidth={2} aria-hidden="true" />
            </IconButton>
          </div>
        ))}
      </div>
      <WorkspaceAdd onAdd={onAdd} />
    </>
  );
}

export function WorkspaceRepos({ repos }: WorkspaceReposProps) {
  if (repos.length === 0) {
    return <div style={pathStyle}>No repos discovered.</div>;
  }
  return (
    <div role="list">
      {repos.map((repo) => (
        <div key={repo.path} role="listitem" style={rowStyle}>
          <span style={nameStyle}>{repo.name}</span>
          <span style={pathStyle} title={repo.path}>
            {repo.path}
          </span>
          <Chip title="Base branch">{repo.base}</Chip>
        </div>
      ))}
    </div>
  );
}
