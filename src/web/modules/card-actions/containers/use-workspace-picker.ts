import { useEffect, useState } from "react";
import {
  useAddWorkspaceFolderMutation,
  useDiscoverFolderQuery,
  useFolderBrowser,
  useRemoveWorkspaceFolderMutation,
  useWorkspaceFoldersQuery,
} from "@/queries/workspace-folders-queries";
import type { WorkspacePickerModel } from "@/modules/card-actions/components/WorkspacePickerSection";
import { NETWORK_FAILURE_COPY } from "@/modules/card-actions/domain/start-copy";
import type { RepoChoice } from "@/modules/card-actions/domain/start-request";
import {
  chosenRepos,
  isRepoChecked,
  resolveFolder,
} from "@/modules/card-actions/domain/workspace-picker";

interface RepoSelection {
  folder: string | null;
  toggles: Record<string, boolean>;
  bases: Record<string, string>;
}

const NO_SELECTION: RepoSelection = { folder: null, toggles: {}, bases: {} };

export interface WorkspacePicker {
  view: WorkspacePickerModel;
  selectedFolder: string | null;
  chosen: RepoChoice[];
}

/**
 * Own the workspace choice of a start dialog: the selected folder, its repos and the ticked repos with their base branch.
 *
 * @remarks
 * The ticks and base overrides belong to the folder they were made in, so picking a folder, even the same one, starts them again and reads its repos again. `onInteraction` runs on every change the user makes, so a stale failure clears.
 */
export function useWorkspacePicker(onInteraction: () => void): WorkspacePicker {
  const foldersQuery = useWorkspaceFoldersQuery();
  const addMutation = useAddWorkspaceFolderMutation();
  const removeMutation = useRemoveWorkspaceFolderMutation();
  const browser = useFolderBrowser();
  const [selection, setSelection] = useState<RepoSelection>(NO_SELECTION);
  const [seededFolder, setSeededFolder] = useState<string | null>(null);

  const folders = foldersQuery.data?.folders ?? [];
  const selectedFolder = resolveFolder(
    folders,
    foldersQuery.data?.lastUsed ?? null,
    selection.folder,
  );
  const discover = useDiscoverFolderQuery(
    selectedFolder,
    selectedFolder !== null && selectedFolder === seededFolder,
  );
  const repos =
    selectedFolder === null || discover.isFetching
      ? null
      : discover.isError
        ? selection.folder === selectedFolder
          ? []
          : null
        : (discover.data?.repos ?? null);
  useEffect(() => {
    if (foldersQuery.error !== null) console.error(foldersQuery.error);
  }, [foldersQuery.error]);
  useEffect(() => {
    if (discover.error !== null) console.error(discover.error);
  }, [discover.error]);
  const own = selection.folder === selectedFolder ? selection : NO_SELECTION;

  const startSelection = (path: string) => {
    setSeededFolder(null);
    setSelection({ folder: path, toggles: {}, bases: {} });
    onInteraction();
  };

  const selectFolder = (path: string) => {
    startSelection(path);
    if (path === selectedFolder) {
      void discover.refetch({ cancelRefetch: false });
    }
  };

  const addFolder = async (path: string): Promise<string | null> => {
    try {
      const result = await addMutation.mutateAsync(path);
      if (!result.ok) return result.error;
      startSelection(path);
      setSeededFolder(path);
      return null;
    } catch (err) {
      console.error(err);
      return NETWORK_FAILURE_COPY;
    }
  };

  const view: WorkspacePickerModel = {
    folders,
    selectedFolder,
    repos,
    toggles: own.toggles,
    bases: own.bases,
    browser,
    onSelectFolder: selectFolder,
    onRemoveFolder: (path) =>
      removeMutation.mutate(path, { onError: (err) => console.error(err) }),
    onAddFolder: addFolder,
    onToggleRepo: (path) => {
      onInteraction();
      setSelection({
        folder: selectedFolder,
        toggles: { ...own.toggles, [path]: !isRepoChecked(own.toggles, path) },
        bases: own.bases,
      });
    },
    onBaseChange: (path, base) => {
      onInteraction();
      setSelection({
        folder: selectedFolder,
        toggles: own.toggles,
        bases: { ...own.bases, [path]: base },
      });
    },
  };

  return {
    view,
    selectedFolder,
    chosen: chosenRepos(repos, own.toggles, own.bases),
  };
}
