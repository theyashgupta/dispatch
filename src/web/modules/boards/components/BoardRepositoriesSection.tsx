import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import type { RepositoryValues } from "@/modules/boards/domain/board-form";
import type { BoardSettingsErrors } from "@/modules/boards/domain/board-settings";
import { BoardRepositoryList } from "./BoardRepositoryList";
import { BoardSettingsSection } from "./BoardSettingsSection";

interface BoardRepositoriesSectionProps {
  repositories: RepositoryValues[];
  pathOnly: boolean;
  errors: BoardSettingsErrors;
  canSave: boolean;
  saving: boolean;
  onChange: (index: number, patch: Partial<RepositoryValues>) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
  onBrowse: (index: number) => void;
  onSave: () => void;
}

export function BoardRepositoriesSection({
  repositories,
  pathOnly,
  errors,
  canSave,
  saving,
  onChange,
  onAdd,
  onRemove,
  onBrowse,
  onSave,
}: BoardRepositoriesSectionProps) {
  return (
    <BoardSettingsSection
      id="board-settings-repositories"
      title="Repositories"
      description="Dispatch cuts a worktree from these repositories at each session start."
      canSave={canSave}
      saving={saving}
      onSave={onSave}
    >
      {repositories.length === 0 && (
        <Empty className="gap-2 border p-6">
          <EmptyHeader className="max-w-none gap-1">
            <EmptyTitle className="text-base font-semibold">
              This board has no repository.
            </EmptyTitle>
            <EmptyDescription>
              Add a repository, or create one in the board folder.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      <BoardRepositoryList
        repositories={repositories}
        pathOnly={pathOnly}
        rowErrors={errors.repositoryRows}
        error={errors.repositories}
        onChange={onChange}
        onAdd={onAdd}
        onRemove={onRemove}
        onBrowse={onBrowse}
      />
    </BoardSettingsSection>
  );
}
