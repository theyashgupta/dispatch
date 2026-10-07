import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { DEFAULT_BOARD_KEY } from "../../../../shared/board-key.js";
import type { Board } from "../../../../shared/types.js";
import { BoardFormDialog } from "@/modules/boards/components/BoardFormDialog";
import { keyClash } from "@/modules/boards/domain/board-archive";
import {
  checkBoardForm,
  EMPTY_FORM,
  EMPTY_REPOSITORY,
  failureText,
  formValuesFromBoard,
  toCreateInput,
  toUpdateInput,
  type BoardFormErrors,
  type BoardFormValues,
} from "@/modules/boards/domain/board-form";
import {
  useCreateBoardMutation,
  useUpdateBoardMutation,
} from "@/modules/boards/queries/boards-queries";

export type BoardFormTarget =
  { mode: "create" } | { mode: "edit"; board: Board };

interface BoardFormContainerProps {
  target: BoardFormTarget;
  boards: Board[];
  knownLinearTeamKeys: string[];
  onClose: () => void;
}

export function BoardFormContainer({
  target,
  boards,
  knownLinearTeamKeys,
  onClose,
}: BoardFormContainerProps) {
  const create = useCreateBoardMutation();
  const update = useUpdateBoardMutation();
  const [values, setValues] = useState<BoardFormValues>(
    target.mode === "edit" ? formValuesFromBoard(target.board) : EMPTY_FORM,
  );
  const [attempted, setAttempted] = useState(false);
  const [keyTouched, setKeyTouched] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const submitting = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const isDefault =
    target.mode === "edit" && target.board.key === DEFAULT_BOARD_KEY;
  const pending = create.isPending || update.isPending;
  const found = checkBoardForm(values, {
    mode: target.mode,
    isDefault,
    boards,
    knownLinearTeamKeys,
  });
  let errors: BoardFormErrors = {};
  if (attempted) errors = found;
  else if (keyTouched && found.key !== undefined) errors = { key: found.key };

  const submit = async () => {
    if (submitting.current) return;
    setAttempted(true);
    if (Object.keys(found).length > 0) return;
    setFailure(null);
    submitting.current = true;
    let result;
    try {
      result =
        target.mode === "create"
          ? await create.mutateAsync(toCreateInput(values))
          : await update.mutateAsync({
              key: target.board.key,
              input: toUpdateInput(values, target.board.key),
            });
    } finally {
      submitting.current = false;
    }
    if (!mounted.current) return;
    if (!result.ok) {
      setFailure(
        failureText(
          target.mode === "create" ? "Create board failed" : "Save failed",
          result.error,
        ),
      );
      return;
    }
    toast.success(
      `Board ${result.board.name} ${target.mode === "create" ? "created" : "saved"}.`,
    );
    onClose();
  };

  return (
    <BoardFormDialog
      mode={target.mode}
      title={
        target.mode === "create"
          ? "New board"
          : `Edit board ${target.board.name}`
      }
      isDefault={isDefault}
      values={values}
      errors={errors}
      clashingTeamKey={
        target.mode === "edit" && keyClash(target.board, knownLinearTeamKeys)
          ? target.board.key
          : null
      }
      failure={failure}
      pending={pending}
      onChange={(patch) => setValues((prev) => ({ ...prev, ...patch }))}
      onRepositoryChange={(index, patch) =>
        setValues((prev) => ({
          ...prev,
          repositories: prev.repositories.map((repo, i) =>
            i === index ? { ...repo, ...patch } : repo,
          ),
        }))
      }
      onAddRepository={() =>
        setValues((prev) => ({
          ...prev,
          repositories: [...prev.repositories, EMPTY_REPOSITORY],
        }))
      }
      onRemoveRepository={(index) =>
        setValues((prev) => ({
          ...prev,
          repositories: prev.repositories.filter((_, i) => i !== index),
        }))
      }
      onKeyBlur={() => setKeyTouched(true)}
      onSubmit={() => void submit()}
      onClose={() => {
        if (!submitting.current) onClose();
      }}
    />
  );
}
