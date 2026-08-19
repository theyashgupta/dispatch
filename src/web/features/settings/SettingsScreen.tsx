import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type Ref,
  type SetStateAction,
} from "react";
import {
  ArrowLeft,
  Bell,
  Bot,
  ClipboardList,
  Copy,
  Filter,
  FolderGit2,
  Globe,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import {
  DEFAULT_CLAUDE_ARGS,
  type FilterCapabilities,
  type FilterOption,
  type Playbook,
  type SourceFilters,
  type TunnelState,
} from "../../../shared/types.js";
import {
  addWorkspaceFolder,
  deletePlaybook,
  disableRemote,
  enableRemote,
  getCleanupDelay,
  getClaudeArgs,
  getLinearFilters,
  getLinearOptions,
  getPlaybooks,
  getWorkspaceFolders,
  previewLinearFilters,
  removeWorkspaceFolder,
  saveCleanupDelay,
  saveClaudeArgs,
  saveLinearFilters,
} from "../../lib/api.js";
import { playChime } from "../../lib/chime.js";
import { Button } from "../../primitives/Button.js";
import { Field } from "../../primitives/Field.js";
import { focusRing } from "../../primitives/focus-ring.js";
import { IconButton } from "../../primitives/IconButton.js";
import { Modal, type ModalControl } from "../../primitives/Modal.js";
import { Notice } from "../../primitives/Notice.js";
import { QrCode } from "../../primitives/QrCode.js";
import { MultiSelect } from "../modals/index.js";
import { WorkspaceAdd } from "../workspaces/index.js";
import { PlaybookEditorModal } from "./PlaybookEditorModal.js";

export type SettingsTab =
  | "filters"
  | "models"
  | "workspaces"
  | "playbooks"
  | "remote"
  | "notifications"
  | "cleanup";

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

function useFiltersTab(onSaved: () => void): FiltersTab {
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
        onSaved();
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
}

function FiltersTabSection({ filters }: FiltersTabSectionProps) {
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
            flex: "1 1 auto",
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
                      ...focusRing(cycleFocus),
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
                  ...focusRing(activeFocus),
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

interface RemoteTab {
  pending: boolean;
  handleEnable: () => Promise<void>;
  handleDisable: () => Promise<void>;
}

function useRemoteTab(): RemoteTab {
  const [pending, setPending] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  async function handleEnable() {
    if (pending) return;
    setPending(true);
    try {
      await enableRemote();
    } catch (err) {
      console.error("enableRemote failed", err);
    } finally {
      if (mountedRef.current) setPending(false);
    }
  }

  async function handleDisable() {
    if (pending) return;
    setPending(true);
    try {
      await disableRemote();
    } catch (err) {
      console.error("disableRemote failed", err);
    } finally {
      if (mountedRef.current) setPending(false);
    }
  }

  return { pending, handleEnable, handleDisable };
}

function useCopyFlash(): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(id);
  }, [copied]);
  const copy = (text: string) => {
    void navigator.clipboard.writeText(text).then(() => setCopied(true));
  };
  return [copied, copy];
}

const remoteSectionStyle = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-lg)",
  flex: "1 1 auto",
  minHeight: 0,
} as const;

const remoteBodyTextStyle = {
  fontFamily: "var(--font-ui)",
  fontSize: "var(--font-body)",
  lineHeight: "var(--line-body)",
  color: "var(--text)",
} as const;

const remoteHelperTextStyle = {
  fontFamily: "var(--font-ui)",
  fontSize: "var(--font-label)",
  lineHeight: "var(--line-label)",
  color: "var(--text-muted)",
} as const;

const remoteStatusRowStyle = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-xs)",
  fontFamily: "var(--font-ui)",
  fontSize: "var(--font-label)",
  fontWeight: "var(--weight-semibold)",
  lineHeight: "var(--line-label)",
  color: "var(--text)",
} as const;

const remoteDotStyle = {
  width: "8px",
  height: "8px",
  borderRadius: "50%",
  flex: "0 0 auto",
} as const;

const remoteFieldBlockStyle = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-xs)",
} as const;

const remoteMonoRowStyle = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-xs)",
} as const;

const remoteMonoTextStyle = {
  fontFamily: "var(--font-mono)",
  fontSize: "var(--font-label)",
  lineHeight: "var(--line-label)",
  color: "var(--text)",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
} as const;

const remoteMonoLinkStyle = {
  ...remoteMonoTextStyle,
  color: "var(--accent)",
  textDecoration: "none",
} as const;

function RemoteStatusRow({ color, text }: { color: string; text: string }) {
  return (
    <div role="status" aria-live="polite" style={remoteStatusRowStyle}>
      <span
        aria-hidden="true"
        style={{ ...remoteDotStyle, background: color }}
      />
      {text}
    </div>
  );
}

interface RemoteTabSectionProps {
  tunnelState: TunnelState;
  remoteTab: RemoteTab;
}

function RemoteTabSection({ tunnelState, remoteTab }: RemoteTabSectionProps) {
  const { pending, handleEnable, handleDisable } = remoteTab;
  const [urlCopied, copyUrl] = useCopyFlash();
  const [codeCopied, copyCode] = useCopyFlash();
  const [brewCopied, copyBrew] = useCopyFlash();

  if (tunnelState.status === "off") {
    return (
      <div style={remoteSectionStyle}>
        <div style={remoteBodyTextStyle}>
          Reach this board — including live terminals — from any device over a
          temporary public link, guarded by an access code.
        </div>
        <div>
          <Button
            variant="primary"
            loading={pending}
            onClick={() => void handleEnable()}
          >
            {pending ? "Starting…" : "Enable remote access"}
          </Button>
        </div>
        <span style={remoteHelperTextStyle}>
          Uses an on-demand Cloudflare tunnel — requires cloudflared.
        </span>
      </div>
    );
  }

  if (tunnelState.status === "starting") {
    return (
      <div style={remoteSectionStyle}>
        <RemoteStatusRow color="var(--status-stale)" text="Starting tunnel…" />
        <div>
          <Button variant="primary" disabled loading>
            Enable remote access
          </Button>
        </div>
      </div>
    );
  }

  if (tunnelState.status === "on") {
    return (
      <div style={remoteSectionStyle}>
        <RemoteStatusRow color="var(--status-ok)" text="Remote access on" />
        <div style={remoteFieldBlockStyle}>
          <Field>Public URL</Field>
          <div style={remoteMonoRowStyle}>
            <a
              href={tunnelState.url}
              target="_blank"
              rel="noopener noreferrer"
              style={remoteMonoLinkStyle}
            >
              {tunnelState.url}
            </a>
            <IconButton
              aria-label={urlCopied ? "Copied" : "Copy public URL"}
              onClick={() => copyUrl(tunnelState.url)}
            >
              <Copy size={14} strokeWidth={2} aria-hidden="true" />
            </IconButton>
          </div>
        </div>
        <QrCode
          value={`${tunnelState.url}?code=${encodeURIComponent(tunnelState.code)}`}
        />
        <div style={remoteFieldBlockStyle}>
          <Field>Access code — enter this on a device without the QR</Field>
          <div style={remoteMonoRowStyle}>
            <span style={remoteMonoTextStyle}>{tunnelState.code}</span>
            <IconButton
              aria-label={codeCopied ? "Copied" : "Copy access code"}
              onClick={() => copyCode(tunnelState.code)}
            >
              <Copy size={14} strokeWidth={2} aria-hidden="true" />
            </IconButton>
          </div>
        </div>
        <div>
          <Button
            variant="secondary"
            loading={pending}
            onClick={() => void handleDisable()}
          >
            {pending ? "Disabling…" : "Disable remote access"}
          </Button>
        </div>
      </div>
    );
  }

  if (tunnelState.status === "error") {
    return (
      <div style={remoteSectionStyle}>
        <RemoteStatusRow
          color="var(--status-down)"
          text={tunnelState.message}
        />
        <div>
          <Button
            variant="primary"
            loading={pending}
            onClick={() => void handleEnable()}
          >
            {pending ? "Starting…" : "Enable remote access"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div style={remoteSectionStyle}>
      <RemoteStatusRow
        color="var(--status-down)"
        text="cloudflared not found"
      />
      <div style={remoteBodyTextStyle}>{tunnelState.installHint}</div>
      <div style={remoteFieldBlockStyle}>
        <Field>Install command</Field>
        <div style={remoteMonoRowStyle}>
          <span style={remoteMonoTextStyle}>brew install cloudflared</span>
          <IconButton
            aria-label={brewCopied ? "Copied" : "Copy install command"}
            onClick={() => copyBrew("brew install cloudflared")}
          >
            <Copy size={14} strokeWidth={2} aria-hidden="true" />
          </IconButton>
        </div>
      </div>
    </div>
  );
}

type DesktopPermission = "granted" | "denied" | "default" | "unsupported";

function useDesktopPermission(): {
  status: DesktopPermission;
  request: () => void;
} {
  const [status, setStatus] = useState<DesktopPermission>(() =>
    "Notification" in window ? Notification.permission : "unsupported",
  );

  const request = useCallback(() => {
    if (!("Notification" in window)) return;
    void Notification.requestPermission().then((result) => {
      setStatus(result);
    });
  }, []);

  return { status, request };
}

interface NotificationsTabSectionProps {
  soundEnabled: boolean;
  onToggleSound: (enabled: boolean) => void;
}

function NotificationsTabSection({
  soundEnabled,
  onToggleSound,
}: NotificationsTabSectionProps) {
  const { status, request } = useDesktopPermission();
  const [soundFocus, setSoundFocus] = useState(false);

  return (
    <div style={remoteSectionStyle}>
      <div style={remoteFieldBlockStyle}>
        <Field>Desktop notifications</Field>
        {status === "granted" && (
          <RemoteStatusRow
            color="var(--status-ok)"
            text="Enabled — you'll get a system notification when a card needs your input or an agent finishes."
          />
        )}
        {status === "denied" && (
          <RemoteStatusRow
            color="var(--status-down)"
            text="Blocked — enable notifications for this site in your browser settings."
          />
        )}
        {status === "unsupported" && (
          <span style={remoteHelperTextStyle}>
            Not supported in this browser.
          </span>
        )}
        {status === "default" && (
          <>
            <span style={remoteBodyTextStyle}>
              Get a system notification when a card needs your input or an agent
              finishes.
            </span>
            <div>
              <Button variant="secondary" onClick={request}>
                Enable notifications
              </Button>
            </div>
          </>
        )}
      </div>

      <div style={remoteFieldBlockStyle}>
        <Field>Sound</Field>
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
            checked={soundEnabled}
            onChange={() => onToggleSound(!soundEnabled)}
            onFocus={(e) =>
              setSoundFocus(e.currentTarget.matches(":focus-visible"))
            }
            onBlur={() => setSoundFocus(false)}
            style={{
              accentColor: "var(--accent)",
              borderRadius: "var(--radius)",
              ...focusRing(soundFocus),
              flex: "0 0 auto",
            }}
          />
          <span style={remoteBodyTextStyle}>
            Play a gentle chime for the same moments
          </span>
        </label>
        <div>
          <Button variant="secondary" onClick={() => playChime()}>
            Test sound
          </Button>
        </div>
      </div>
    </div>
  );
}

interface CleanupTab {
  draftDays: string;
  setDraftDays: Dispatch<SetStateAction<string>>;
  saving: boolean;
  saveError: boolean;
  loadError: boolean;
  validationError: boolean;
  handleSave: () => Promise<void>;
}

function useCleanupTab(onSaved: () => void): CleanupTab {
  const [draftDays, setDraftDays] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const { cleanupDelayDays } = await getCleanupDelay();
        if (!active) return;
        setDraftDays(String(cleanupDelayDays));
      } catch (err) {
        console.error("getCleanupDelay failed", err);
        if (!active) return;
        setLoadError(true);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const trimmed = draftDays.trim();
  const parsedDays = Number(trimmed);
  const validationError =
    trimmed === "" ||
    !Number.isInteger(parsedDays) ||
    parsedDays < 0 ||
    parsedDays > 90;

  async function handleSave() {
    if (saving || validationError) return;
    setSaving(true);
    setSaveError(false);
    try {
      const result = await saveCleanupDelay(parsedDays);
      if (result.ok) {
        onSaved();
        return;
      }
      setSaveError(true);
    } catch (err) {
      console.error("saveCleanupDelay failed", err);
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  }

  return {
    draftDays,
    setDraftDays,
    saving,
    saveError,
    loadError,
    validationError,
    handleSave,
  };
}

interface CleanupTabSectionProps {
  cleanupTab: CleanupTab;
}

function CleanupTabSection({ cleanupTab }: CleanupTabSectionProps) {
  const { draftDays, setDraftDays, saveError, loadError, validationError } =
    cleanupTab;
  const [focused, setFocused] = useState(false);

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
          Couldn't load the cleanup delay — reopen settings to retry.
        </span>
      )}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-sm)",
        }}
      >
        <Field>Cleanup delay (days)</Field>
        <input
          type="number"
          min={0}
          max={90}
          step={1}
          value={draftDays}
          onChange={(e) => setDraftDays(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          aria-label="Cleanup delay in days"
          style={{
            height: "32px",
            width: "96px",
            padding: "0 var(--space-sm)",
            background: "var(--surface-card)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            color: "var(--text)",
            fontFamily: "var(--font-ui)",
            fontSize: "var(--font-body)",
            lineHeight: "var(--line-body)",
            outline: "none",
            ...focusRing(focused),
          }}
        />
        <span
          style={{
            fontSize: "var(--font-label)",
            lineHeight: "var(--line-label)",
            color: "var(--text-muted)",
          }}
        >
          0 = clean up immediately when a card reaches Done.
        </span>
        {validationError && (
          <div
            role="alert"
            style={{
              fontSize: "var(--font-label)",
              fontWeight: "var(--weight-semibold)",
              lineHeight: "var(--line-label)",
              color: "var(--destructive)",
            }}
          >
            Enter a whole number between 0 and 90.
          </div>
        )}
        {saveError && (
          <Notice
            tone="destructive"
            label="Couldn't save cleanup delay — try again."
          />
        )}
      </div>
    </>
  );
}

interface ModelsTab {
  draftArgs: string;
  setDraftArgs: Dispatch<SetStateAction<string>>;
  loaded: boolean;
  saving: boolean;
  saveError: boolean;
  loadError: boolean;
  handleSave: () => Promise<void>;
}

function useModelsTab(onSaved: () => void): ModelsTab {
  const [draftArgs, setDraftArgs] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const { claudeArgs } = await getClaudeArgs();
        if (!active) return;
        setDraftArgs(claudeArgs);
        setLoaded(true);
      } catch (err) {
        console.error("getClaudeArgs failed", err);
        if (!active) return;
        setLoadError(true);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  async function handleSave() {
    if (saving || !loaded) return;
    setSaving(true);
    setSaveError(false);
    try {
      const result = await saveClaudeArgs(draftArgs);
      if (result.ok) {
        onSaved();
        return;
      }
      setSaveError(true);
    } catch (err) {
      console.error("saveClaudeArgs failed", err);
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  }

  return {
    draftArgs,
    setDraftArgs,
    loaded,
    saving,
    saveError,
    loadError,
    handleSave,
  };
}

interface ResetLinkProps {
  onClick: () => void;
}

function ResetLink({ onClick }: ResetLinkProps) {
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={(e) => setFocus(e.currentTarget.matches(":focus-visible"))}
      onBlur={() => setFocus(false)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--space-xs)",
        padding: 0,
        background: "transparent",
        border: "none",
        color: hover || focus ? "var(--text)" : "var(--text-muted)",
        fontFamily: "var(--font-ui)",
        fontSize: "var(--font-label)",
        lineHeight: "var(--line-label)",
        cursor: "pointer",
        ...focusRing(focus),
      }}
    >
      <RotateCcw size={12} strokeWidth={2} aria-hidden="true" />
      Reset to default
    </button>
  );
}

interface ModelsTabSectionProps {
  modelsTab: ModelsTab;
}

function ModelsTabSection({ modelsTab }: ModelsTabSectionProps) {
  const { draftArgs, setDraftArgs, saveError, loadError } = modelsTab;
  const [focused, setFocused] = useState(false);

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
          Couldn't load Claude's launch arguments — reopen settings to retry.
        </span>
      )}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-lg)",
          padding: "var(--space-lg)",
          background: "var(--surface-card)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-sm)",
          }}
        >
          <Bot size={16} strokeWidth={2} aria-hidden="true" />
          <span
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: "var(--font-heading)",
              fontWeight: "var(--weight-semibold)",
              lineHeight: "var(--line-heading)",
              color: "var(--text)",
            }}
          >
            Claude
          </span>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-xs)",
          }}
        >
          <Field>Command</Field>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "var(--font-body)",
              lineHeight: "var(--line-body)",
              color: "var(--text-muted)",
            }}
          >
            claude
          </span>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-xs)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <Field>Arguments</Field>
            <ResetLink onClick={() => setDraftArgs(DEFAULT_CLAUDE_ARGS)} />
          </div>
          <input
            type="text"
            value={draftArgs}
            onChange={(e) => setDraftArgs(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            spellCheck={false}
            aria-label="Claude launch arguments"
            placeholder={DEFAULT_CLAUDE_ARGS}
            style={{
              height: "32px",
              width: "100%",
              padding: "0 var(--space-sm)",
              background: "var(--surface-column)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
              color: "var(--text)",
              fontFamily: "var(--font-mono)",
              fontSize: "var(--font-body)",
              lineHeight: "var(--line-body)",
              ...focusRing(focused),
            }}
          />
          <span
            style={{
              fontSize: "var(--font-label)",
              lineHeight: "var(--line-label)",
              color: "var(--text-muted)",
            }}
          >
            Passed to <code>claude</code> every time a session starts, resumes,
            or restarts. Clear this to get Claude's normal permission prompts
            instead of skipping them.
          </span>
        </div>

        {saveError && (
          <Notice
            tone="destructive"
            label="Couldn't save Claude's arguments — try again."
          />
        )}
      </div>
    </>
  );
}

interface WorkspacesTab {
  folders: string[];
  loading: boolean;
  loadError: boolean;
  addFolder: (path: string) => Promise<string | null>;
  removeFolder: (path: string) => void;
}

function useWorkspacesTab(): WorkspacesTab {
  const [folders, setFolders] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const { folders: fs } = await getWorkspaceFolders();
        if (!active) return;
        setFolders(fs);
      } catch (err) {
        console.error("getWorkspaceFolders failed", err);
        if (!active) return;
        setLoadError(true);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const addFolder = useCallback(
    async (path: string): Promise<string | null> => {
      try {
        const result = await addWorkspaceFolder(path);
        if (!result.ok) return result.error;
        setFolders((prev) => (prev.includes(path) ? prev : [...prev, path]));
        return null;
      } catch (err) {
        console.error("addWorkspaceFolder failed", err);
        return "Couldn't reach the server. Try again.";
      }
    },
    [],
  );

  const removeFolder = useCallback((path: string) => {
    removeWorkspaceFolder(path).catch((err) => {
      console.error("removeWorkspaceFolder failed", err);
    });
    setFolders((prev) => prev.filter((f) => f !== path));
  }, []);

  return { folders, loading, loadError, addFolder, removeFolder };
}

interface WorkspaceRowProps {
  path: string;
  onRemove: () => void;
}

function WorkspaceRow({ path, onRemove }: WorkspaceRowProps) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-sm)",
        padding: "var(--space-sm)",
        borderRadius: "var(--radius)",
        background: hover ? "var(--surface-card-hover)" : "transparent",
      }}
    >
      <FolderGit2
        size={14}
        strokeWidth={2}
        aria-hidden="true"
        style={{ color: "var(--text-muted)", flex: "0 0 auto" }}
      />
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
        {path}
      </span>
      <IconButton aria-label={`Remove workspace ${path}`} onClick={onRemove}>
        <Trash2 size={14} strokeWidth={2} aria-hidden="true" />
      </IconButton>
    </div>
  );
}

interface WorkspacesTabSectionProps {
  workspacesTab: WorkspacesTab;
}

function WorkspacesTabSection({ workspacesTab }: WorkspacesTabSectionProps) {
  const { folders, loading, loadError, addFolder, removeFolder } =
    workspacesTab;

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
      <WorkspaceAdd
        onAdd={addFolder}
        hint="Add a folder that contains the git repos you start tickets in."
      />

      {loading && (
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

      {!loading && loadError && (
        <Notice
          tone="destructive"
          label="Couldn't load workspaces — reopen settings to retry."
        />
      )}

      {!loading && !loadError && folders.length === 0 && (
        <Notice tone="muted" label="No workspaces yet">
          Add a folder above to start tickets in it.
        </Notice>
      )}

      {!loading && !loadError && folders.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {folders.map((f) => (
            <WorkspaceRow key={f} path={f} onRemove={() => removeFolder(f)} />
          ))}
        </div>
      )}
    </div>
  );
}

interface SettingsSection {
  id: SettingsTab;
  label: string;
  icon: LucideIcon;
}

const SETTINGS_SECTIONS: SettingsSection[] = [
  { id: "filters", label: "Sync filters", icon: Filter },
  { id: "models", label: "Models", icon: Bot },
  { id: "workspaces", label: "Workspaces", icon: FolderGit2 },
  { id: "playbooks", label: "Playbooks", icon: ClipboardList },
  { id: "remote", label: "Remote", icon: Globe },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "cleanup", label: "Cleanup", icon: Trash2 },
];

const overlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 18,
  display: "flex",
  background: "var(--bg)",
  transition: "opacity 150ms ease-out",
};

const sidebarStyle: CSSProperties = {
  flex: "0 0 auto",
  width: "var(--orca-nav-width)",
  maxWidth: "80vw",
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-lg)",
  padding: "var(--space-lg)",
  background: "var(--surface-column)",
  borderRight: "1px solid var(--border)",
  overflowY: "auto",
};

const navListStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "2px",
};

const contentColumnStyle: CSSProperties = {
  flex: "1 1 auto",
  minWidth: 0,
  display: "flex",
  flexDirection: "column",
  minHeight: 0,
};

const contentHeaderStyle: CSSProperties = {
  flex: "0 0 auto",
  padding: "var(--space-xl) var(--space-2xl) var(--space-lg)",
  borderBottom: "1px solid var(--border)",
};

const contentHeadingStyle: CSSProperties = {
  margin: 0,
  fontFamily: "var(--font-ui)",
  fontSize: "var(--font-display)",
  fontWeight: "var(--weight-semibold)",
  lineHeight: "var(--line-display)",
  color: "var(--text)",
};

const contentBodyStyle: CSSProperties = {
  flex: "1 1 auto",
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-lg)",
  padding: "var(--space-xl) var(--space-2xl)",
  maxWidth: "640px",
  width: "100%",
};

const footerStyle: CSSProperties = {
  flex: "0 0 auto",
  display: "flex",
  justifyContent: "flex-end",
  padding: "var(--space-lg) var(--space-2xl)",
  borderTop: "1px solid var(--border)",
};

const navButtonBaseStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-sm)",
  width: "100%",
  padding: "var(--space-sm)",
  border: "none",
  borderRadius: "var(--radius)",
  fontFamily: "var(--font-ui)",
  fontSize: "var(--font-label)",
  fontWeight: "var(--weight-semibold)",
  lineHeight: "var(--line-label)",
  textAlign: "left",
  cursor: "pointer",
  outline: "none",
};

interface BackToAppButtonProps {
  onClick: () => void;
  ref?: Ref<HTMLButtonElement>;
}

function BackToAppButton({ onClick, ref }: BackToAppButtonProps) {
  const [hover, setHover] = useState(false);
  const [focused, setFocused] = useState(false);
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={(e) => setFocused(e.currentTarget.matches(":focus-visible"))}
      onBlur={() => setFocused(false)}
      style={{
        ...navButtonBaseStyle,
        background: hover ? "var(--surface-card-hover)" : "transparent",
        color: "var(--text-muted)",
        ...focusRing(focused),
      }}
    >
      <ArrowLeft size={14} strokeWidth={2} aria-hidden="true" />
      Back to app
    </button>
  );
}

interface SettingsNavItemProps {
  icon: LucideIcon;
  label: string;
  active: boolean;
  onClick: () => void;
}

function SettingsNavItem({
  icon: Icon,
  label,
  active,
  onClick,
}: SettingsNavItemProps) {
  const [hover, setHover] = useState(false);
  const [focused, setFocused] = useState(false);
  return (
    <button
      type="button"
      aria-current={active ? "page" : undefined}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={(e) => setFocused(e.currentTarget.matches(":focus-visible"))}
      onBlur={() => setFocused(false)}
      style={{
        ...navButtonBaseStyle,
        background: active
          ? "var(--surface-card)"
          : hover
            ? "var(--surface-card-hover)"
            : "transparent",
        color: active ? "var(--text)" : "var(--text-muted)",
        ...focusRing(focused),
      }}
    >
      <Icon size={14} strokeWidth={2} aria-hidden="true" />
      {label}
    </button>
  );
}

interface SettingsScreenProps {
  onClose: () => void;
  initialTab?: SettingsTab;
  tunnelState: TunnelState;
  soundEnabled: boolean;
  onToggleSound: (enabled: boolean) => void;
}

export function SettingsScreen({
  onClose,
  initialTab = "filters",
  tunnelState,
  soundEnabled,
  onToggleSound,
}: SettingsScreenProps) {
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const [entered, setEntered] = useState(false);
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const backButtonRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  const requestClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    setTimeout(() => onCloseRef.current(), 150);
  }, []);

  useEffect(() => {
    backButtonRef.current?.focus();
    const raf = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const filters = useFiltersTab(requestClose);
  const modelsTab = useModelsTab(requestClose);
  const workspacesTab = useWorkspacesTab();
  const playbooksTab = usePlaybooksTab(tab === "playbooks");
  const remoteTab = useRemoteTab();
  const cleanupTab = useCleanupTab(requestClose);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (playbooksTab.editorState || playbooksTab.deleteTarget) return;
      requestClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [playbooksTab.editorState, playbooksTab.deleteTarget, requestClose]);

  const activeSection =
    SETTINGS_SECTIONS.find((section) => section.id === tab) ??
    SETTINGS_SECTIONS[0];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
      style={{
        ...overlayStyle,
        opacity: entered && !closing ? 1 : 0,
      }}
    >
      <nav aria-label="Settings sections" style={sidebarStyle}>
        <SettingsScreen.BackToApp ref={backButtonRef} onClick={requestClose} />
        <div style={navListStyle}>
          {SETTINGS_SECTIONS.map((section) => (
            <SettingsNavItem
              key={section.id}
              icon={section.icon}
              label={section.label}
              active={tab === section.id}
              onClick={() => setTab(section.id)}
            />
          ))}
        </div>
      </nav>

      <div style={contentColumnStyle}>
        <div style={contentHeaderStyle}>
          <h1 style={contentHeadingStyle}>{activeSection.label}</h1>
        </div>

        <div style={contentBodyStyle}>
          {tab === "filters" && <SettingsScreen.FiltersTab filters={filters} />}
          {tab === "models" && (
            <SettingsScreen.ModelsTab modelsTab={modelsTab} />
          )}
          {tab === "workspaces" && (
            <SettingsScreen.WorkspacesTab workspacesTab={workspacesTab} />
          )}
          {tab === "playbooks" && (
            <SettingsScreen.PlaybooksTab playbooksTab={playbooksTab} />
          )}
          {tab === "remote" && (
            <SettingsScreen.RemoteTab
              tunnelState={tunnelState}
              remoteTab={remoteTab}
            />
          )}
          {tab === "notifications" && (
            <SettingsScreen.NotificationsTab
              soundEnabled={soundEnabled}
              onToggleSound={onToggleSound}
            />
          )}
          {tab === "cleanup" && (
            <SettingsScreen.CleanupTab cleanupTab={cleanupTab} />
          )}
        </div>

        {tab === "filters" && (
          <div style={footerStyle}>
            <Button
              variant="primary"
              onClick={() => void filters.handleSave()}
              disabled={!filters.draft}
              loading={filters.saving}
            >
              {filters.saving ? "Saving filters…" : "Save Filters"}
            </Button>
          </div>
        )}
        {tab === "cleanup" && (
          <div style={footerStyle}>
            <Button
              variant="primary"
              onClick={() => void cleanupTab.handleSave()}
              disabled={cleanupTab.validationError}
              loading={cleanupTab.saving}
            >
              {cleanupTab.saving ? "Saving…" : "Save cleanup delay"}
            </Button>
          </div>
        )}
        {tab === "models" && (
          <div style={footerStyle}>
            <Button
              variant="primary"
              onClick={() => void modelsTab.handleSave()}
              disabled={!modelsTab.loaded}
              loading={modelsTab.saving}
            >
              {modelsTab.saving ? "Saving…" : "Save"}
            </Button>
          </div>
        )}
      </div>

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
    </div>
  );
}

SettingsScreen.BackToApp = BackToAppButton;
SettingsScreen.FiltersTab = FiltersTabSection;
SettingsScreen.ModelsTab = ModelsTabSection;
SettingsScreen.WorkspacesTab = WorkspacesTabSection;
SettingsScreen.PlaybooksTab = PlaybooksTabSection;
SettingsScreen.RemoteTab = RemoteTabSection;
SettingsScreen.NotificationsTab = NotificationsTabSection;
SettingsScreen.CleanupTab = CleanupTabSection;
