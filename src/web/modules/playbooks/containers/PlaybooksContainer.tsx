import { useEffect, useMemo, useRef, useState } from "react";
import type { Playbook } from "../../../../shared/types.js";
import { PlaybooksList } from "@/modules/playbooks/components/PlaybooksList";
import { PlaybookDeleteContainer } from "./PlaybookDeleteContainer";
import {
  PlaybookEditorContainer,
  type PlaybookEditorTarget,
} from "./PlaybookEditorContainer";
import { duplicateName } from "@/modules/playbooks/domain/playbook-names";
import {
  useCreatePlaybookMutation,
  usePlaybooksQuery,
} from "@/modules/playbooks/queries/playbooks-queries";

interface PlaybooksContainerProps {
  createRequest: number;
  onCountChange: (count: number | undefined) => void;
}

export function PlaybooksContainer({
  createRequest,
  onCountChange,
}: PlaybooksContainerProps) {
  const query = usePlaybooksQuery();
  const create = useCreatePlaybookMutation();
  const [editor, setEditor] = useState<PlaybookEditorTarget | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Playbook | null>(null);
  const [duplicateError, setDuplicateError] = useState(false);
  const duplicating = useRef(false);
  const handledCreateRequest = useRef(0);

  const playbooks = useMemo(
    () =>
      query.data &&
      [...query.data].sort((a, b) => a.name.localeCompare(b.name)),
    [query.data],
  );
  const count = playbooks?.length;

  useEffect(() => {
    onCountChange(count);
  }, [count, onCountChange]);

  useEffect(() => {
    if (createRequest === 0 || createRequest === handledCreateRequest.current)
      return;
    handledCreateRequest.current = createRequest;
    setEditor({ mode: "create" });
  }, [createRequest]);

  const handleDuplicate = async (playbook: Playbook) => {
    if (duplicating.current) return;
    duplicating.current = true;
    setDuplicateError(false);
    const names = (playbooks ?? []).map((p) => p.name);
    try {
      const result = await create.mutateAsync({
        name: duplicateName(names, playbook.name),
        body: playbook.body,
      });
      if (!result.ok) setDuplicateError(true);
    } catch {
      setDuplicateError(true);
    } finally {
      duplicating.current = false;
    }
  };

  return (
    <>
      <PlaybooksList
        playbooks={playbooks ?? null}
        loading={query.isPending}
        loadError={query.isError}
        duplicateError={duplicateError}
        onEdit={(playbook) => {
          const { slug } = playbook;
          if (slug !== undefined) {
            setEditor({ mode: "edit", playbook: { ...playbook, slug } });
          }
        }}
        onDuplicate={(playbook) => void handleDuplicate(playbook)}
        onDelete={setDeleteTarget}
      />
      {editor && (
        <PlaybookEditorContainer
          target={editor}
          existingNames={(playbooks ?? [])
            .filter(
              (p) =>
                p.slug !==
                (editor.mode === "edit" ? editor.playbook.slug : undefined),
            )
            .map((p) => p.name)}
          onClose={() => setEditor(null)}
        />
      )}
      {deleteTarget && (
        <PlaybookDeleteContainer
          playbook={deleteTarget}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </>
  );
}
