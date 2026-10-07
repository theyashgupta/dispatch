import type { ComponentProps } from "react";
import { FolderGit2, Trash2 } from "lucide-react";
import type { DiscoveredRepo } from "../../../../shared/types.js";
import { WorkspaceAdd } from "@/components/WorkspaceAdd";
import { Button } from "@/components/ui/button";

interface WorkspaceFoldersProps {
  folders: { path: string; repos: DiscoveredRepo[] }[];
  browser: ComponentProps<typeof WorkspaceAdd>["browser"];
  onAdd: (path: string) => Promise<string | null>;
  onRemove: (path: string) => void;
}

function basename(folderPath: string): string {
  return folderPath.split("/").filter(Boolean).pop() ?? folderPath;
}

export function WorkspaceFolders({
  folders,
  browser,
  onAdd,
  onRemove,
}: WorkspaceFoldersProps) {
  return (
    <>
      <div role="list" className="mb-2 flex flex-col gap-1">
        {folders.map((folder) => (
          <div
            key={folder.path}
            role="listitem"
            className="flex items-center gap-2 py-1"
          >
            <FolderGit2
              aria-hidden="true"
              className="size-3.5 shrink-0 text-muted-foreground"
            />
            <span className="shrink-0 text-base text-foreground">
              {basename(folder.path)}
            </span>
            <span
              className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground"
              title={folder.path}
            >
              {folder.path}
            </span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {folder.repos.length === 1
                ? "1 repo"
                : `${folder.repos.length} repos`}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={`Remove ${folder.path}`}
              title="Remove folder"
              onClick={() => onRemove(folder.path)}
            >
              <Trash2 aria-hidden="true" />
            </Button>
          </div>
        ))}
      </div>
      <WorkspaceAdd onAdd={onAdd} browser={browser} />
    </>
  );
}
