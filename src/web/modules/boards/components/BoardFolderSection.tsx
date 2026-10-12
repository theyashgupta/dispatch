import { BoardSettingsSection } from "./BoardSettingsSection";

interface BoardFolderSectionProps {
  folder: string | null;
}

export function BoardFolderSection({ folder }: BoardFolderSectionProps) {
  return (
    <BoardSettingsSection
      id="board-settings-folder"
      title="Folder"
      description="Dispatch makes one folder for each session in this folder."
    >
      <p className="font-mono text-sm break-all">
        {folder ?? "No folder is set."}
      </p>
    </BoardSettingsSection>
  );
}
