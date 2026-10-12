import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { createdBoardText } from "../../../../shared/board-create.js";
import { DEFAULT_BOARD_KEY } from "../../../../shared/board-key.js";
import type { Board } from "../../../../shared/types.js";
import { BoardFormDialog } from "@/modules/boards/components/BoardFormDialog";
import {
  addRepository,
  changeRepository,
  checkBoardForm,
  EMPTY_FORM,
  failureText,
  folderPlaceholder,
  previewKey,
  refusalErrors,
  removeRepository,
  takenKeySet,
  toCreateInput,
  visibleErrors,
  type BoardFormErrors,
  type BoardFormValues,
} from "@/modules/boards/domain/board-form";
import { useCreateBoardMutation } from "@/queries/board-create-queries";
import { useBoardsNavigation } from "./use-boards-navigation";
import { useRepositoryBrowser } from "./use-repository-browser";

interface BoardFormContainerProps {
  boards: Board[];
  knownLinearTeamKeys: string[];
  onClose: () => void;
}

export function BoardFormContainer({
  boards,
  knownLinearTeamKeys,
  onClose,
}: BoardFormContainerProps) {
  const create = useCreateBoardMutation();
  const nav = useBoardsNavigation();
  const [values, setValues] = useState<BoardFormValues>(EMPTY_FORM);
  const [attempted, setAttempted] = useState(false);
  const [done, setDone] = useState(false);
  const [keyTouched, setKeyTouched] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [refused, setRefused] = useState<BoardFormErrors>({});
  const submitting = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const found = checkBoardForm(values, { boards, knownLinearTeamKeys });
  const errors = visibleErrors(found, refused, {
    attempted,
    keyTouched,
    hidden: done || create.isPending,
  });
  const taken = takenKeySet(boards, knownLinearTeamKeys);
  const preview = previewKey(values.name, taken);
  const localRoot = boards.find(
    (board) => board.key === DEFAULT_BOARD_KEY,
  )?.workspaceRoot;

  const edit = (apply: (prev: BoardFormValues) => BoardFormValues) => {
    setRefused({});
    setValues(apply);
  };
  const repositoryBrowser = useRepositoryBrowser((index, path) =>
    edit((prev) => changeRepository(prev, index, { path })),
  );

  const submit = async () => {
    if (submitting.current || done) return;
    setAttempted(true);
    if (Object.keys(found).length > 0) return;
    setFailure(null);
    setRefused({});
    submitting.current = true;
    try {
      const created = await create.mutateAsync(toCreateInput(values));
      if (created.ok) {
        toast.success(createdBoardText(created.board));
      }
      if (!mounted.current) return;
      if (created.ok) {
        setDone(true);
        nav.openBoard(created.board.key);
        return;
      }
      const placed = refusalErrors(created, values);
      setRefused(placed.errors);
      if (placed.form !== null) {
        setFailure(failureText("Create board failed", placed.form));
      }
    } finally {
      submitting.current = false;
    }
  };

  return (
    <BoardFormDialog
      values={values}
      errors={errors}
      failure={failure}
      pending={create.isPending || done}
      placeholderKey={preview ?? ""}
      placeholderFolder={folderPlaceholder(
        localRoot,
        values.key.trim() || preview || "",
      )}
      browser={{
        ...repositoryBrowser.browser,
        onSelect: repositoryBrowser.select,
      }}
      onChange={(patch) => edit((prev) => ({ ...prev, ...patch }))}
      onRepositoryChange={(index, patch) =>
        edit((prev) => changeRepository(prev, index, patch))
      }
      onAddRepository={() => edit(addRepository)}
      onRemoveRepository={(index) =>
        edit((prev) => removeRepository(prev, index))
      }
      onBrowse={repositoryBrowser.open}
      onUseKey={(key) => edit((prev) => ({ ...prev, key }))}
      onKeyBlur={() => setKeyTouched(true)}
      onSubmit={() => void submit()}
      onClose={() => {
        if (!submitting.current) onClose();
      }}
    />
  );
}
