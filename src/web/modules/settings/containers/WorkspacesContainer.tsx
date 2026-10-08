import { DEFAULT_BOARD_KEY } from "../../../../shared/board-key.js";
import { SettingsPanelLayout } from "@/components/SettingsPanelLayout";
import { WorkspacesSection } from "@/modules/settings/components/WorkspacesSection";
import {
  useAddWorkspaceFolderMutation,
  useFolderBrowser,
  useRemoveWorkspaceFolderMutation,
  useWorkspaceFoldersQuery,
} from "@/queries/workspace-folders-queries";

export function WorkspacesContainer() {
  const query = useWorkspaceFoldersQuery(DEFAULT_BOARD_KEY);
  const add = useAddWorkspaceFolderMutation(DEFAULT_BOARD_KEY);
  const remove = useRemoveWorkspaceFolderMutation(DEFAULT_BOARD_KEY);
  const browser = useFolderBrowser();

  const addFolder = async (path: string): Promise<string | null> => {
    try {
      const result = await add.mutateAsync(path);
      return result.ok ? null : result.error;
    } catch {
      return "Couldn't reach the server. Try again.";
    }
  };

  return (
    <SettingsPanelLayout>
      <WorkspacesSection
        folders={query.data?.folders ?? []}
        loading={query.isPending}
        loadError={query.isError}
        browser={browser}
        onAdd={addFolder}
        onRemove={(path) => remove.mutate(path)}
      />
    </SettingsPanelLayout>
  );
}
