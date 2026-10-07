import { useEffect, useMemo, useRef, useState } from "react";
import type { Playbook } from "../../../../shared/types.js";
import { PageHeaderActions } from "@/components/PageHeaderActions";
import { PageHeaderCount } from "@/components/PageHeaderCount";
import { Button } from "@/components/ui/button";
import { PlaybooksList } from "@/modules/playbooks/components/PlaybooksList";
import { PlaybookDeleteContainer } from "./PlaybookDeleteContainer";
import {
  PlaybookEditorContainer,
  type PlaybookEditorTarget,
} from "./PlaybookEditorContainer";
import { duplicateName } from "@/modules/playbooks/domain/playbook-names";
import { usePlaybookCreateRequest } from "@/modules/playbooks/hooks/use-playbook-create-request";
import {
  useCreatePlaybookMutation,
  usePlaybooksQuery,
} from "@/modules/playbooks/queries/playbooks-queries";

export function PlaybooksContainer() {
  const query = usePlaybooksQuery();
  const [createRequest, setCreateRequest] = usePlaybookCreateRequest();
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

  useEffect(() => () => setCreateRequest(0), [setCreateRequest]);

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

export function PlaybooksHeaderContainer() {
  const count = usePlaybooksQuery().data?.length;
  const [createRequest, setCreateRequest] = usePlaybookCreateRequest();
  return (
    <>
      {count != null && <PageHeaderCount count={count} />}
      <PageHeaderActions>
        <Button size="sm" onClick={() => setCreateRequest(createRequest + 1)}>
          New playbook
        </Button>
      </PageHeaderActions>
    </>
  );
}
