import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import type {
  FilterCapabilities,
  FilterOption,
  Playbook,
  SourceFilters,
} from "../../../shared/types.js";
import {
  deletePlaybook,
  getLinearFilters,
  getLinearOptions,
  getPlaybooks,
  previewLinearFilters,
  saveLinearFilters,
} from "../../lib/api.js";
import { Button } from "../../primitives/Button.js";
import { Field } from "../../primitives/Field.js";
import { IconButton } from "../../primitives/IconButton.js";
import { Modal, type ModalControl } from "../../primitives/Modal.js";
import { Notice } from "../../primitives/Notice.js";
import { MultiSelect } from "./MultiSelect.js";
import { PlaybookEditorModal } from "./PlaybookEditorModal.js";

export type SettingsTab = "filters" | "playbooks";

interface SettingsTabButtonProps {
  label: string;
  active: boolean;
  onClick: () => void;
}

function SettingsTabButton({ label, active, onClick }: SettingsTabButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "0 0 var(--space-sm)",
        background: "transparent",
        border: "none",
        borderBottom: active
          ? "2px solid var(--accent)"
          : "2px solid transparent",
        color: active ? "var(--text)" : "var(--text-muted)",
        fontFamily: "var(--font-ui)",
        fontSize: "var(--font-label)",
        fontWeight: "var(--weight-semibold)",
        lineHeight: "var(--line-label)",
        cursor: "pointer",
        outline: "none",
      }}
    >
      {label}
    </button>
  );
}

interface PlaybookListRowProps {
  playbook: Playbook;
  onEdit: () => void;
  onDelete: () => void;
}

function PlaybookListRow({ playbook, onEdit, onDelete }: PlaybookListRowProps) {
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
            label="Couldn't delete playbook — try again."
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

type MultiDim = "assignees" | "projects" | "teams";

const MULTI_DIMS: MultiDim[] = ["assignees", "projects", "teams"];

const MULTI_COPY: Record<
  MultiDim,
  { label: string; placeholder: string; emptyText: string }
> = {
  assignees: {
    label: "Assignees",
    placeholder: "Any assignee",
    emptyText: "No assignees found",
  },
  projects: {
    label: "Projects",
    placeholder: "Any project",
    emptyText: "No projects found",
  },
  teams: {
    label: "Teams",
    placeholder: "Any team",
    emptyText: "No teams found",
  },
};

const focusRing = (on: boolean): string =>
  on ? "0 0 0 2px var(--accent)" : "none";

type PreviewState =
  | { status: "counting" }
  | { status: "ready"; count: number; more: boolean }
  | { status: "unavailable" };

interface FiltersTab {
  draft: SourceFilters | null;
  setDraft: Dispatch<SetStateAction<SourceFilters | null>>;
  capabilities: FilterCapabilities | null;
  options: Record<MultiDim, FilterOption[]>;
  optLoading: Record<MultiDim, boolean>;
  optError: Record<MultiDim, boolean>;
  optTruncated: Record<MultiDim, boolean>;
  preview: PreviewState;
  saving: boolean;
  saveError: boolean;
  loadError: boolean;
  handleSave: () => Promise<void>;
}

function useFiltersTab(modalRef: RefObject<ModalControl | null>): FiltersTab {
  const [draft, setDraft] = useState<SourceFilters | null>(null);
  const [capabilities, setCapabilities] = useState<FilterCapabilities | null>(
    null,
  );
  const [options, setOptions] = useState<Record<MultiDim, FilterOption[]>>({
    assignees: [],
    projects: [],
    teams: [],
  });
  const [optLoading, setOptLoading] = useState<Record<MultiDim, boolean>>({
    assignees: true,
    projects: true,
    teams: true,
  });
  const [optError, setOptError] = useState<Record<MultiDim, boolean>>({
    assignees: false,
    projects: false,
    teams: false,
  });
  const [optTruncated, setOptTruncated] = useState<Record<MultiDim, boolean>>({
    assignees: false,
    projects: false,
    teams: false,
  });
  const [preview, setPreview] = useState<PreviewState>({ status: "counting" });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const { filters, capabilities: caps } = await getLinearFilters();
        if (!active) return;
        setDraft(filters);
        setCapabilities(caps);
      } catch (err) {
        console.error("getLinearFilters failed", err);
        if (!active) return;
        setLoadError(true);
      }
    })();
    for (const dim of MULTI_DIMS) {
      void (async () => {
        try {
          const { options: opts, truncated } = await getLinearOptions(dim);
          if (!active) return;
          setOptions((prev) => ({ ...prev, [dim]: opts }));
          setOptTruncated((prev) => ({ ...prev, [dim]: truncated }));
        } catch (err) {
          console.error("getLinearOptions failed", err);
          if (!active) return;
          setOptError((prev) => ({ ...prev, [dim]: true }));
        } finally {
          if (active) setOptLoading((prev) => ({ ...prev, [dim]: false }));
        }
      })();
    }
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!draft) return;
    setPreview({ status: "counting" });
    let active = true;
    const timer = setTimeout(() => {
      void (async () => {
        const result = await previewLinearFilters(draft);
        if (!active) return;
        setPreview(
          result
            ? { status: "ready", count: result.count, more: result.more }
            : { status: "unavailable" },
        );
      })();
    }, 500);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [draft]);

  async function handleSave() {
    if (saving || !draft) return;
    setSaving(true);
    setSaveError(false);
    try {
      const result = await saveLinearFilters(draft);
      if (result.ok) {
        modalRef.current?.requestClose();
        return;
      }
      setSaveError(true);
    } catch (err) {
      console.error("saveLinearFilters failed", err);
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  }

  return {
    draft,
    setDraft,
    capabilities,
    options,
    optLoading,
    optError,
    optTruncated,
    preview,
    saving,
    saveError,
    loadError,
    handleSave,
  };
}

interface FiltersTabSectionProps {
  filters: FiltersTab;
  firstTriggerRef: RefObject<HTMLButtonElement | null>;
}

function FiltersTabSection({
  filters,
  firstTriggerRef,
}: FiltersTabSectionProps) {
  const {
    draft,
    setDraft,
    capabilities,
    options,
    optLoading,
    optError,
    optTruncated,
    preview,
    saveError,
    loadError,
  } = filters;
  const [cycleFocus, setCycleFocus] = useState(false);
  const [activeFocus, setActiveFocus] = useState(false);

  const previewText =
    preview.status === "counting"
      ? "counting…"
      : preview.status === "unavailable"
        ? "preview unavailable"
        : preview.more
          ? "Matches 250+ tickets"
          : `Matches ${preview.count} ${preview.count === 1 ? "ticket" : "tickets"}`;

  const firstMultiDim = capabilities?.dimensions.find((d) => d !== "cycle");

  return (
    <>
      {loadError && (
        <span
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "var(--font-body)",
            lineHeight: "var(--line-body)",
            color: "var(--text-muted)",
          }}
        >
          Couldn't load filters — reopen settings to retry.
        </span>
      )}
      {capabilities && draft && (
        <div
          className="scroll-stable-y"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-lg)",
            flex: "0 1 auto",
            minHeight: 0,
            overflowY: "auto",
          }}
        >
          {capabilities.dimensions.map((dim) =>
            dim === "cycle" ? (
              <div
                key="cycle"
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "var(--space-xs)",
                }}
              >
                <Field>Current cycle</Field>
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "var(--space-sm)",
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={draft.currentCycle}
                    onChange={() =>
                      setDraft((prev) =>
                        prev
                          ? { ...prev, currentCycle: !prev.currentCycle }
                          : prev,
                      )
                    }
                    onFocus={(e) =>
                      setCycleFocus(e.currentTarget.matches(":focus-visible"))
                    }
                    onBlur={() => setCycleFocus(false)}
                    style={{
                      accentColor: "var(--accent)",
                      borderRadius: "var(--radius)",
                      outline: "none",
                      boxShadow: focusRing(cycleFocus),
                      flex: "0 0 auto",
                    }}
                  />
                  <span
                    style={{
                      fontFamily: "var(--font-ui)",
                      fontSize: "var(--font-body)",
                      lineHeight: "var(--line-body)",
                      color: "var(--text)",
                    }}
                  >
                    Current cycle only
                  </span>
                </label>
                <span
                  style={{
                    fontFamily: "var(--font-ui)",
                    fontSize: "var(--font-body)",
                    lineHeight: "var(--line-body)",
                    color: "var(--text-muted)",
                  }}
                >
                  Backlog tickets often have no cycle, so this can drop matches
                  to near zero.
                </span>
              </div>
            ) : (
              <div
                key={dim}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "var(--space-xs)",
                }}
              >
                <Field>{MULTI_COPY[dim].label}</Field>
                <MultiSelect
                  label={MULTI_COPY[dim].label}
                  placeholder={MULTI_COPY[dim].placeholder}
                  options={options[dim]}
                  selected={draft[dim]}
                  loading={optLoading[dim]}
                  loadError={optError[dim]}
                  emptyText={MULTI_COPY[dim].emptyText}
                  triggerRef={
                    dim === firstMultiDim ? firstTriggerRef : undefined
                  }
                  onChange={(next) =>
                    setDraft((prev) => (prev ? { ...prev, [dim]: next } : prev))
                  }
                />
                {optError[dim] && (
                  <span
                    style={{
                      fontFamily: "var(--font-ui)",
                      fontSize: "var(--font-body)",
                      lineHeight: "var(--line-body)",
                      color: "var(--text-muted)",
                    }}
                  >
                    Couldn't load options — reopen settings to retry.
                  </span>
                )}
                {optTruncated[dim] && (
                  <span
                    style={{
                      fontFamily: "var(--font-ui)",
                      fontSize: "var(--font-body)",
                      lineHeight: "var(--line-body)",
                      color: "var(--text-muted)",
                    }}
                  >
                    Showing first 250 options.
                  </span>
                )}
              </div>
            ),
          )}

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-xs)",
            }}
          >
            <Field>Active tickets</Field>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--space-sm)",
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={draft.includeActive}
                onChange={() =>
                  setDraft((prev) =>
                    prev
                      ? { ...prev, includeActive: !prev.includeActive }
                      : prev,
                  )
                }
                onFocus={(e) =>
                  setActiveFocus(e.currentTarget.matches(":focus-visible"))
                }
                onBlur={() => setActiveFocus(false)}
                style={{
                  accentColor: "var(--accent)",
                  borderRadius: "var(--radius)",
                  outline: "none",
                  boxShadow: focusRing(activeFocus),
                  flex: "0 0 auto",
                }}
              />
              <span
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: "var(--font-body)",
                  lineHeight: "var(--line-body)",
                  color: "var(--text)",
                }}
              >
                Include active tickets (In Progress, In Review, ...)
              </span>
            </label>
          </div>

          <span
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: "var(--font-body)",
              lineHeight: "var(--line-body)",
              color: "var(--text-muted)",
            }}
          >
            {previewText}
          </span>

          {saveError && (
            <Notice
              tone="destructive"
              label="Couldn't save filters — try again."
            />
          )}
        </div>
      )}
    </>
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
  openCreate: () => void;
  openEdit: (playbook: Playbook) => void;
  closeEditor: () => void;
  openDelete: (playbook: Playbook) => void;
  closeDelete: () => void;
  reload: () => Promise<void>;
}

function usePlaybooksTab(active: boolean): PlaybooksTab {
  const [playbooks, setPlaybooks] = useState<Playbook[] | null>(null);
  const [playbooksLoading, setPlaybooksLoading] = useState(false);
  const [playbooksLoadError, setPlaybooksLoadError] = useState(false);
  const [visited, setVisited] = useState(false);
  const [editorState, setEditorState] = useState<PlaybooksEditorState | null>(
    null,
  );
  const [deleteTarget, setDeleteTarget] = useState<Playbook | null>(null);

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
    if (!active || visited) return;
    setVisited(true);
    void reload();
  }, [active, visited, reload]);

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

  return {
    playbooks,
    playbooksLoading,
    playbooksLoadError,
    editorState,
    deleteTarget,
    openCreate,
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
    openCreate,
    openEdit,
    openDelete,
  } = playbooksTab;

  return (
    <div
      className="scroll-stable-y"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-lg)",
        flex: "1 1 auto",
        minHeight: 0,
        overflowY: "auto",
      }}
    >
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <Button variant="primary" onClick={openCreate}>
          <Plus size={14} strokeWidth={2} aria-hidden="true" />
          New playbook
        </Button>
      </div>

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
          label="Couldn't load playbooks — reopen settings to retry."
        />
      )}

      {!playbooksLoading &&
        !playbooksLoadError &&
        playbooks !== null &&
        playbooks.length === 0 && (
          <Notice tone="muted" label="No playbooks yet">
            Create one, or generate a draft with AI.
          </Notice>
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
                onDelete={() => openDelete(p)}
              />
            ))}
          </div>
        )}
    </div>
  );
}

interface SettingsModalProps {
  onClose: () => void;
  initialTab?: SettingsTab;
}

export function SettingsModal({
  onClose,
  initialTab = "filters",
}: SettingsModalProps) {
  const modalRef = useRef<ModalControl>(null);
  const firstTriggerRef = useRef<HTMLButtonElement>(null);
  const [tab, setTab] = useState<SettingsTab>(initialTab);

  const filters = useFiltersTab(modalRef);
  const playbooksTab = usePlaybooksTab(tab === "playbooks");

  return (
    <Modal
      ariaLabel="Settings"
      onClose={onClose}
      controlRef={modalRef}
      initialFocusRef={firstTriggerRef}
      dialogStyle={
        tab === "playbooks"
          ? { width: "560px", maxHeight: "80vh" }
          : { maxHeight: "80vh" }
      }
    >
      <Modal.Header>Settings</Modal.Header>
      <Modal.Body>
        <div
          style={{
            display: "flex",
            gap: "var(--space-lg)",
            borderBottom: "1px solid var(--border)",
            flex: "0 0 auto",
          }}
        >
          <SettingsTabButton
            label="Sync filters"
            active={tab === "filters"}
            onClick={() => setTab("filters")}
          />
          <SettingsTabButton
            label="Playbooks"
            active={tab === "playbooks"}
            onClick={() => setTab("playbooks")}
          />
        </div>

        {tab === "filters" && (
          <SettingsModal.FiltersTab
            filters={filters}
            firstTriggerRef={firstTriggerRef}
          />
        )}

        {tab === "playbooks" && (
          <SettingsModal.PlaybooksTab playbooksTab={playbooksTab} />
        )}

        {playbooksTab.editorState && (
          <PlaybookEditorModal
            mode={playbooksTab.editorState.mode}
            playbook={playbooksTab.editorState.playbook}
            existingNames={(playbooksTab.playbooks ?? [])
              .filter(
                (p) => p.slug !== playbooksTab.editorState?.playbook?.slug,
              )
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
      </Modal.Body>
      <Modal.Actions>
        {tab === "filters" ? (
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              flex: "0 0 auto",
            }}
          >
            <Button
              variant="primary"
              onClick={() => {
                firstTriggerRef.current?.focus();
                void filters.handleSave();
              }}
              disabled={!filters.draft}
              loading={filters.saving}
            >
              {filters.saving ? "Saving filters…" : "Save Filters"}
            </Button>
          </div>
        ) : null}
      </Modal.Actions>
    </Modal>
  );
}

SettingsModal.FiltersTab = FiltersTabSection;
SettingsModal.PlaybooksTab = PlaybooksTabSection;
