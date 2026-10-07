import type { BoardKey, DiscoveredRepo } from "../../../../shared/types.js";
import { WorkspaceFolders } from "@/modules/workspaces/components/WorkspaceFolders";
import {
  useAddWorkspaceFolderMutation,
  useFolderBrowser,
  useRemoveWorkspaceFolderMutation,
} from "@/queries/workspace-folders-queries";

interface WorkspaceFoldersContainerProps {
  board: BoardKey;
  folders: { path: string; repos: DiscoveredRepo[] }[];
  onChanged: () => void;
  onActionError: (message: string | null) => void;
}

export function WorkspaceFoldersContainer({
  board,
  folders,
  onChanged,
  onActionError,
}: WorkspaceFoldersContainerProps) {
  const add = useAddWorkspaceFolderMutation(board);
  const remove = useRemoveWorkspaceFolderMutation(board);
  const browser = useFolderBrowser();

  const addFolder = async (path: string): Promise<string | null> => {
    try {
      const result = await add.mutateAsync(path);
      if (!result.ok) return result.error;
      onChanged();
      return null;
    } catch (err) {
      console.error("addWorkspaceFolder failed", err);
      return "Couldn't reach the server. Try again.";
    }
  };

  const removeFolder = (path: string): void => {
    onActionError(null);
    remove
      .mutateAsync(path)
      .then(onChanged)
      .catch((err: unknown) => {
        console.error("removeWorkspaceFolder failed", err);
        onActionError("Couldn't remove that folder.");
      });
  };

  return (
    <WorkspaceFolders
      folders={folders}
      browser={browser}
      onAdd={addFolder}
      onRemove={removeFolder}
    />
  );
}
