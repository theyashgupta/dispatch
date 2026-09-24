import { useCallback, useEffect, useRef, useState } from "react";
import { Copy, Pencil, Trash2 } from "lucide-react";
import type { Playbook } from "../../../shared/types.js";
import { createPlaybook, deletePlaybook, getPlaybooks } from "../../lib/api.js";
import { Button } from "../../primitives/Button.js";
import { IconButton } from "../../primitives/IconButton.js";
import { Modal, type ModalControl } from "../../primitives/Modal.js";
import { Notice } from "../../primitives/Notice.js";
import { PageBody } from "../../primitives/PageBody.js";
import { PlaybookEditorModal } from "./PlaybookEditorModal.js";
import { duplicateName } from "./playbook-names.js";

interface PlaybookListRowProps {
  playbook: Playbook;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

function PlaybookListRow({
  playbook,
  onEdit,
  onDuplicate,
  onDelete,
}: PlaybookListRowProps) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onClick={onEdit}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-sm)",
        padding: "var(--space-sm)",
        borderRadius: "var(--radius)",
        background: hover ? "var(--surface-card-hover)" : "transparent",
        cursor: "pointer",
      }}
    >
      <span
        style={{
          flex: "1 1 auto",
          minWidth: 0,
          fontFamily: "var(--font-mono)",
          fontSize: "var(--font-label)",
          fontWeight: "var(--weight-semibold)",
          lineHeight: "var(--line-label)",
          color: "var(--text)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {playbook.name}
      </span>
      <IconButton
        aria-label={`Duplicate ${playbook.name}`}
        onClick={(e) => {
          e.stopPropagation();
          onDuplicate();
        }}
      >
        <Copy size={14} strokeWidth={2} aria-hidden="true" />
      </IconButton>
      <IconButton
        aria-label={`Edit ${playbook.name}`}
        onClick={(e) => {
          e.stopPropagation();
          onEdit();
        }}
      >
        <Pencil size={14} strokeWidth={2} aria-hidden="true" />
      </IconButton>
      <IconButton
        aria-label={`Delete ${playbook.name}`}
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
      >
        <Trash2 size={14} strokeWidth={2} aria-hidden="true" />
      </IconButton>
    </div>
  );
}

interface PlaybookDeleteConfirmProps {
  playbook: Playbook;
  onClose: () => void;
  onDeleted: () => void;
}

function PlaybookDeleteConfirm({
  playbook,
  onClose,
  onDeleted,
}: PlaybookDeleteConfirmProps) {
  const modalRef = useRef<ModalControl>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);

  async function handleDelete() {
    if (pending || playbook.slug === undefined) return;
    setPending(true);
    keepRef.current?.focus();
    setError(false);
    try {
      const result = await deletePlaybook(playbook.slug);
      if (result.ok) {
        onDeleted();
        return;
      }
      setError(true);
    } catch (err) {
      console.error("deletePlaybook failed", err);
      setError(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal
      ariaLabel={`Delete ${playbook.name}`}
      onClose={onClose}
      controlRef={modalRef}
      initialFocusRef={keepRef}
    >
      <Modal.Header>{playbook.name}</Modal.Header>
      <Modal.Body>
        <div
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "var(--font-body)",
            lineHeight: "var(--line-body)",
            color: "var(--text)",
          }}
        >
          Delete this playbook? This can't be undone.
        </div>
        {error && (
          <Notice
            tone="destructive"
            label="Couldn't delete playbook. Try again."
          />
        )}
      </Modal.Body>
      <Modal.Actions>
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: "var(--space-sm)",
            flex: "0 0 auto",
          }}
        >
          <Button
            ref={keepRef}
            variant="secondary"
            onClick={() => modalRef.current?.requestClose()}
          >
            Keep playbook
          </Button>
          <Button
            variant="danger"
            loading={pending}
            onClick={() => void handleDelete()}
          >
            {pending ? "Deleting playbook…" : "Delete playbook"}
          </Button>
        </div>
      </Modal.Actions>
    </Modal>
  );
}

interface PlaybooksEditorState {
  mode: "create" | "edit";
  playbook?: Playbook;
}

interface PlaybooksTab {
  playbooks: Playbook[] | null;
  playbooksLoading: boolean;
  playbooksLoadError: boolean;
  editorState: PlaybooksEditorState | null;
  deleteTarget: Playbook | null;
  duplicateError: boolean;
  openCreate: () => void;
  duplicate: (playbook: Playbook) => Promise<void>;
  openEdit: (playbook: Playbook) => void;
  closeEditor: () => void;
  openDelete: (playbook: Playbook) => void;
  closeDelete: () => void;
  reload: () => Promise<void>;
}

function usePlaybooksTab(): PlaybooksTab {
  const [playbooks, setPlaybooks] = useState<Playbook[] | null>(null);
  const [playbooksLoading, setPlaybooksLoading] = useState(false);
  const [playbooksLoadError, setPlaybooksLoadError] = useState(false);
  const [editorState, setEditorState] = useState<PlaybooksEditorState | null>(
    null,
  );
  const [deleteTarget, setDeleteTarget] = useState<Playbook | null>(null);
  const [duplicateError, setDuplicateError] = useState(false);
  const duplicating = useRef(false);

  const reload = useCallback(async () => {
    setPlaybooksLoading(true);
    setPlaybooksLoadError(false);
    try {
      const list = await getPlaybooks();
      setPlaybooks([...list].sort((a, b) => a.name.localeCompare(b.name)));
    } catch (err) {
      console.error("getPlaybooks failed", err);
      setPlaybooksLoadError(true);
    } finally {
      setPlaybooksLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const openCreate = useCallback(() => setEditorState({ mode: "create" }), []);
  const openEdit = useCallback(
    (playbook: Playbook) => setEditorState({ mode: "edit", playbook }),
    [],
  );
  const closeEditor = useCallback(() => setEditorState(null), []);
  const openDelete = useCallback(
    (playbook: Playbook) => setDeleteTarget(playbook),
    [],
  );
  const closeDelete = useCallback(() => setDeleteTarget(null), []);
  const duplicate = useCallback(
    async (playbook: Playbook) => {
      if (duplicating.current) return;
      duplicating.current = true;
      setDuplicateError(false);
      const names = (playbooks ?? []).map((p) => p.name);
      try {
        const result = await createPlaybook({
          name: duplicateName(names, playbook.name),
          body: playbook.body,
        });
        if (!result.ok) {
          setDuplicateError(true);
          return;
        }
        await reload();
      } catch (err) {
        console.error("createPlaybook failed", err);
        setDuplicateError(true);
      } finally {
        duplicating.current = false;
      }
    },
    [playbooks, reload],
  );

  return {
    playbooks,
    playbooksLoading,
    playbooksLoadError,
    editorState,
    deleteTarget,
    duplicateError,
    openCreate,
    duplicate,
    openEdit,
    closeEditor,
    openDelete,
    closeDelete,
    reload,
  };
}

interface PlaybooksTabSectionProps {
  playbooksTab: PlaybooksTab;
}

function PlaybooksTabSection({ playbooksTab }: PlaybooksTabSectionProps) {
  const {
    playbooks,
    playbooksLoading,
    playbooksLoadError,
    duplicateError,
    openEdit,
    duplicate,
    openDelete,
  } = playbooksTab;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-lg)",
      }}
    >
      {duplicateError && (
        <Notice
          tone="destructive"
          label="Couldn't duplicate playbook. Try again."
        />
      )}

      {playbooksLoading && (
        <span
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "var(--font-label)",
            fontWeight: "var(--weight-semibold)",
            lineHeight: "var(--line-label)",
            color: "var(--text-muted)",
          }}
        >
          Loading…
        </span>
      )}

      {!playbooksLoading && playbooksLoadError && (
        <Notice
          tone="destructive"
          label="Couldn't load playbooks. Reopen the page to retry."
        />
      )}

      {!playbooksLoading &&
        !playbooksLoadError &&
        playbooks !== null &&
        playbooks.length === 0 && (
          <div style={{ marginTop: "var(--space-lg)" }}>
            <Notice tone="muted" label="No playbooks yet">
              Create one, or generate a draft with AI.
            </Notice>
          </div>
        )}

      {!playbooksLoading &&
        !playbooksLoadError &&
        playbooks !== null &&
        playbooks.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {playbooks.map((p) => (
              <PlaybookListRow
                key={p.slug ?? p.name}
                playbook={p}
                onEdit={() => openEdit(p)}
                onDuplicate={() => void duplicate(p)}
                onDelete={() => openDelete(p)}
              />
            ))}
          </div>
        )}
    </div>
  );
}

interface PlaybooksPageProps {
  createRequest: number;
  onCountChange: (count: number | undefined) => void;
}

export function PlaybooksPage({
  createRequest,
  onCountChange,
}: PlaybooksPageProps) {
  const playbooksTab = usePlaybooksTab();
  const { playbooks, openCreate } = playbooksTab;

  const handledCreateRequest = useRef(0);

  useEffect(() => {
    onCountChange(playbooks?.length);
  }, [playbooks?.length, onCountChange]);

  useEffect(() => {
    if (createRequest === 0 || createRequest === handledCreateRequest.current)
      return;
    handledCreateRequest.current = createRequest;
    openCreate();
  }, [createRequest, openCreate]);

  return (
    <PageBody>
      <PlaybooksTabSection playbooksTab={playbooksTab} />
      {playbooksTab.editorState && (
        <PlaybookEditorModal
          mode={playbooksTab.editorState.mode}
          playbook={playbooksTab.editorState.playbook}
          existingNames={(playbooksTab.playbooks ?? [])
            .filter((p) => p.slug !== playbooksTab.editorState?.playbook?.slug)
            .map((p) => p.name)}
          onSaved={() => {
            playbooksTab.closeEditor();
            void playbooksTab.reload();
          }}
          onClose={playbooksTab.closeEditor}
        />
      )}

      {playbooksTab.deleteTarget && (
        <PlaybookDeleteConfirm
          playbook={playbooksTab.deleteTarget}
          onClose={playbooksTab.closeDelete}
          onDeleted={() => {
            playbooksTab.closeDelete();
            void playbooksTab.reload();
          }}
        />
      )}
    </PageBody>
  );
}
