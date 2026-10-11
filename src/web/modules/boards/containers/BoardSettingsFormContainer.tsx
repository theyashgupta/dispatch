import { useState } from "react";
import { toast } from "sonner";
import { DEFAULT_BOARD_KEY } from "../../../../shared/board-key.js";
import type { Board } from "../../../../shared/types.js";
import { FolderBrowserDialog } from "@/components/FolderBrowserDialog";
import { FieldSet } from "@/components/ui/field";
import { BoardCreateRepositorySection } from "@/modules/boards/components/BoardCreateRepositorySection";
import { BoardFolderSection } from "@/modules/boards/components/BoardFolderSection";
import { BoardNameSection } from "@/modules/boards/components/BoardNameSection";
import { BoardRepositoriesSection } from "@/modules/boards/components/BoardRepositoriesSection";
import { BoardSettingsHeader } from "@/modules/boards/components/BoardSettingsHeader";
import { BoardTeamKeysSection } from "@/modules/boards/components/BoardTeamKeysSection";
import {
  addRepository,
  changeRepository,
  removeRepository,
} from "@/modules/boards/domain/board-form";
import {
  applySaved,
  checkBoardSettings,
  isDirty,
  placeRefusal,
  settingsValuesFromBoard,
  toPatch,
  withNewRepositories,
  type BoardSettingsErrors,
  type BoardSettingsValues,
  type SettingsSection,
} from "@/modules/boards/domain/board-settings";
import { useUpdateBoardMutation } from "@/modules/boards/queries/boards-queries";
import {
  initRepositoryErrorText,
  useInitRepositoryMutation,
} from "@/queries/board-repository-queries";
import { useRepositoryBrowser } from "./use-repository-browser";

interface BoardSettingsFormContainerProps {
  board: Board;
}

export function BoardSettingsFormContainer({
  board,
}: BoardSettingsFormContainerProps) {
  const update = useUpdateBoardMutation();
  const init = useInitRepositoryMutation();
  const [values, setValues] = useState<BoardSettingsValues>(() =>
    settingsValuesFromBoard(board),
  );
  const [errors, setErrors] = useState<BoardSettingsErrors>({});
  const [saving, setSaving] = useState<SettingsSection | null>(null);
  const isDefault = board.key === DEFAULT_BOARD_KEY;
  const createError = initRepositoryErrorText(init.data, init.error);

  const edit = (apply: (prev: BoardSettingsValues) => BoardSettingsValues) => {
    setErrors({});
    setValues(apply);
  };
  const repositoryBrowser = useRepositoryBrowser((index, path) =>
    edit((prev) => changeRepository(prev, index, { path })),
  );
  const canSave = (section: SettingsSection) =>
    !update.isPending && !init.isPending && isDirty(values, board, section);

  const save = async (section: SettingsSection) => {
    if (section === "name") {
      const found = checkBoardSettings(values);
      if (found.name !== undefined) {
        setErrors(found);
        return;
      }
    }
    setErrors({});
    setSaving(section);
    try {
      const result = await update.mutateAsync({
        key: board.key,
        input: toPatch(values, board, section),
      });
      if (!result.ok) {
        setErrors(placeRefusal(result, values, section));
        return;
      }
      setValues((prev) => applySaved(prev, result.board, section));
      toast.success("Board settings saved.");
    } finally {
      setSaving(null);
    }
  };

  const createRepository = async () => {
    const result = await init.mutateAsync(board.key);
    if (!result.ok) return;
    setValues((prev) => withNewRepositories(prev, board, result.board));
    toast.success("Repository created.");
  };

  return (
    <>
      <BoardSettingsHeader
        name={board.name}
        boardKey={board.key}
        archived={board.archived}
      />
      <FieldSet disabled={board.archived} className="min-w-0 gap-4">
        <BoardNameSection
          name={values.name}
          error={errors.name}
          canSave={canSave("name")}
          saving={saving === "name"}
          onChange={(name) => edit((prev) => ({ ...prev, name }))}
          onSave={board.archived ? undefined : () => void save("name")}
        />
        <BoardRepositoriesSection
          repositories={values.repositories}
          pathOnly={isDefault}
          errors={errors}
          canSave={canSave("repositories")}
          saving={saving === "repositories"}
          onChange={(index, patch) =>
            edit((prev) => changeRepository(prev, index, patch))
          }
          onAdd={() => edit(addRepository)}
          onRemove={(index) => edit((prev) => removeRepository(prev, index))}
          onBrowse={repositoryBrowser.open}
          onSave={board.archived ? undefined : () => void save("repositories")}
        />
        {!board.archived && (
          <BoardCreateRepositorySection
            running={init.isPending}
            disabled={update.isPending}
            error={createError}
            onCreate={() => void createRepository()}
          />
        )}
        <BoardFolderSection folder={board.workspaceRoot} />
        {!isDefault && (
          <BoardTeamKeysSection
            value={values.linearTeamKeys}
            error={errors.linearTeamKeys}
            canSave={canSave("linearTeamKeys")}
            saving={saving === "linearTeamKeys"}
            onChange={(linearTeamKeys) =>
              edit((prev) => ({ ...prev, linearTeamKeys }))
            }
            onSave={
              board.archived ? undefined : () => void save("linearTeamKeys")
            }
          />
        )}
      </FieldSet>
      <FolderBrowserDialog
        {...repositoryBrowser.browser}
        onSelect={repositoryBrowser.select}
      />
    </>
  );
}
