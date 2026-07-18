import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronDown, TriangleAlert, X } from "lucide-react";
import type {
  Card as CardModel,
  DiscoveredRepo,
  InvalidPlaybook,
  Playbook,
} from "../../../shared/types.js";
import {
  addWorkspaceFolder,
  discoverFolder,
  getPickerPlaybooks,
  getWorkspaceFolders,
  removeWorkspaceFolder,
  startCard,
} from "../../lib/api.js";
import { Button } from "../../primitives/Button.js";
import { Field } from "../../primitives/Field.js";
import { IconButton } from "../../primitives/IconButton.js";
import { Modal, type ModalControl } from "../../primitives/Modal.js";
import { Notice } from "../../primitives/Notice.js";
import { WorkspaceAdd } from "../workspaces/index.js";

interface StartModalProps {
  card: CardModel;
  onClose: () => void;
  onEditPlaybooks: () => void;
}

const SEED_SLUG_ORDER = [
  "prd-ralph-loop",
  "superpowers",
  "gsd",
  "write-code-directly",
];

const WRITE_CODE_DIRECTLY_NAME = "Write code directly";

const focusRing = (on: boolean): string =>
  on ? "0 0 0 2px var(--accent)" : "none";

function orderSeedRows(valid: Playbook[]): Playbook[] {
  const bySlug = new Map(valid.map((p) => [p.slug, p]));
  const rows: Playbook[] = [];
  for (const slug of SEED_SLUG_ORDER) {
    const p = bySlug.get(slug);
    if (p) rows.push(p);
  }
  return rows;
}

interface FolderRowProps {
  path: string;
  onSelect: () => void;
  onRemove: () => void;
}

function FolderRow({ path, onSelect, onRemove }: FolderRowProps) {
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-xs)",
        background: hover ? "var(--surface-card-hover)" : "transparent",
        borderRadius: "var(--radius)",
      }}
    >
      <button
        type="button"
        onClick={onSelect}
        onFocus={(e) => setFocus(e.currentTarget.matches(":focus-visible"))}
        onBlur={() => setFocus(false)}
        style={{
          flex: "1 1 auto",
          minWidth: 0,
          textAlign: "left",
          padding: "var(--space-sm)",
          background: "transparent",
          border: "none",
          borderRadius: "var(--radius)",
          color: "var(--text)",
          fontFamily: "var(--font-mono)",
          fontSize: "var(--font-label)",
          lineHeight: "var(--line-label)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          cursor: "pointer",
          outline: "none",
          boxShadow: focusRing(focus),
        }}
      >
        {path}
      </button>
      <IconButton aria-label={`Remove folder ${path}`} onClick={onRemove}>
        <X size={12} strokeWidth={2} aria-hidden="true" />
      </IconButton>
    </div>
  );
}

interface FolderPickerProps {
  folders: string[];
  selected: string | null;
  onSelect: (path: string) => void;
  onRemove: (path: string) => void;
  onAdd: (path: string) => Promise<string | null>;
}

function FolderPicker({
  folders,
  selected,
  onSelect,
  onRemove,
  onAdd,
}: FolderPickerProps) {
  const firstRun = folders.length === 0;
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [triggerFocus, setTriggerFocus] = useState(false);
  const [addRowHover, setAddRowHover] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const showAdd = firstRun || adding;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  async function wrappedAdd(path: string): Promise<string | null> {
    const err = await onAdd(path);
    if (err === null) setAdding(false);
    return err;
  }

  function cancelAdd() {
    if (!firstRun) setAdding(false);
  }

  return (
    <div
      ref={rootRef}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.preventDefault();
          setOpen(false);
        }
      }}
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-xs)",
      }}
    >
      {!showAdd && (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          onFocus={(e) =>
            setTriggerFocus(e.currentTarget.matches(":focus-visible"))
          }
          onBlur={() => setTriggerFocus(false)}
          style={{
            height: "32px",
            padding: "0 var(--space-sm)",
            background: "var(--surface-card)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            color: "var(--text)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "var(--space-sm)",
            cursor: "pointer",
            outline: "none",
            boxShadow: focusRing(triggerFocus),
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "var(--font-label)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              minWidth: 0,
            }}
          >
            {selected}
          </span>
          <ChevronDown
            size={12}
            strokeWidth={2}
            aria-hidden="true"
            style={{ color: "var(--text-muted)", flex: "0 0 auto" }}
          />
        </button>
      )}

      {open && !showAdd && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            marginTop: "var(--space-xs)",
            zIndex: 1,
            background: "var(--surface-card)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            display: "flex",
            flexDirection: "column",
            maxHeight: "240px",
            overflowY: "auto",
          }}
        >
          {folders.map((f) => (
            <FolderRow
              key={f}
              path={f}
              onSelect={() => {
                onSelect(f);
                setOpen(false);
              }}
              onRemove={() => onRemove(f)}
            />
          ))}
          <button
            type="button"
            onClick={() => {
              setAdding(true);
              setOpen(false);
            }}
            onMouseEnter={() => setAddRowHover(true)}
            onMouseLeave={() => setAddRowHover(false)}
            style={{
              textAlign: "left",
              padding: "var(--space-sm)",
              background: addRowHover
                ? "var(--surface-card-hover)"
                : "transparent",
              border: "none",
              borderTop: "1px solid var(--border)",
              borderRadius: "var(--radius)",
              color: "var(--text-muted)",
              fontSize: "var(--font-label)",
              fontWeight: "var(--weight-semibold)",
              cursor: "pointer",
              outline: "none",
            }}
          >
            Add folder…
          </button>
        </div>
      )}

      {showAdd && (
        <WorkspaceAdd
          onAdd={wrappedAdd}
          onCancel={cancelAdd}
          hint={
            firstRun
              ? "Add a folder that contains the git repos for this ticket."
              : undefined
          }
        />
      )}
    </div>
  );
}

interface KickoffPlaybookRowProps {
  name: string;
  selected: boolean;
  isDefault: boolean;
  reason?: string;
  onSelect: () => void;
}

function KickoffPlaybookRow({
  name,
  selected,
  isDefault,
  reason,
  onSelect,
}: KickoffPlaybookRowProps) {
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);

  if (reason !== undefined) {
    return (
      <div
        tabIndex={-1}
        aria-disabled="true"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-xs)",
          padding: "var(--space-sm)",
          opacity: 0.5,
          cursor: "default",
        }}
      >
        <TriangleAlert
          size={12}
          strokeWidth={2}
          aria-hidden="true"
          style={{ color: "var(--text-muted)", flex: "0 0 auto" }}
        />
        <span
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "var(--font-body)",
            lineHeight: "var(--line-body)",
            color: "var(--text-muted)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {name} ({reason})
        </span>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onSelect}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={(e) => setFocus(e.currentTarget.matches(":focus-visible"))}
      onBlur={() => setFocus(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-xs)",
        textAlign: "left",
        padding: "var(--space-sm)",
        background: hover ? "var(--surface-card-hover)" : "transparent",
        border: "none",
        borderRadius: "var(--radius)",
        color: "var(--text)",
        fontFamily: "var(--font-ui)",
        fontSize: "var(--font-body)",
        fontWeight: selected
          ? "var(--weight-semibold)"
          : "var(--weight-regular)",
        lineHeight: "var(--line-body)",
        cursor: "pointer",
        outline: "none",
        boxShadow: focusRing(focus),
      }}
    >
      <span
        style={{
          flex: "1 1 auto",
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {name}
      </span>
      {isDefault && (
        <span
          style={{
            flex: "0 0 auto",
            fontSize: "var(--font-label)",
            lineHeight: "var(--line-label)",
            color: "var(--text-muted)",
          }}
        >
          Default
        </span>
      )}
      {selected && (
        <Check
          size={12}
          strokeWidth={2}
          aria-hidden="true"
          style={{ color: "var(--accent)", flex: "0 0 auto" }}
        />
      )}
    </button>
  );
}

interface PickerRow {
  name: string;
  slug?: string;
  reason?: string;
}

interface KickoffPlaybookPickerProps {
  seedRows: PickerRow[];
  restRows: PickerRow[];
  invalidRows: InvalidPlaybook[];
  selected: string | null;
  lastUsed: string | null;
  onSelect: (name: string) => void;
}

function KickoffPlaybookPicker({
  seedRows,
  restRows,
  invalidRows,
  selected,
  lastUsed,
  onSelect,
}: KickoffPlaybookPickerProps) {
  const [open, setOpen] = useState(false);
  const [triggerFocus, setTriggerFocus] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const validRows = [...seedRows, ...restRows];

  return (
    <div
      ref={rootRef}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.preventDefault();
          setOpen(false);
        }
      }}
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-xs)",
      }}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onFocus={(e) =>
          setTriggerFocus(e.currentTarget.matches(":focus-visible"))
        }
        onBlur={() => setTriggerFocus(false)}
        style={{
          height: "32px",
          padding: "0 var(--space-sm)",
          background: "var(--surface-card)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          color: "var(--text)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--space-sm)",
          cursor: "pointer",
          outline: "none",
          boxShadow: focusRing(triggerFocus),
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "var(--font-body)",
            lineHeight: "var(--line-body)",
            color: selected === null ? "var(--text-muted)" : "var(--text)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            minWidth: 0,
          }}
        >
          {selected ?? "None selected"}
        </span>
        <ChevronDown
          size={12}
          strokeWidth={2}
          aria-hidden="true"
          style={{ color: "var(--text-muted)", flex: "0 0 auto" }}
        />
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            marginTop: "var(--space-xs)",
            zIndex: 1,
            background: "var(--surface-card)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            display: "flex",
            flexDirection: "column",
            maxHeight: "240px",
            overflowY: "auto",
          }}
        >
          {validRows.map((row, index) => (
            <div key={row.slug ?? row.name}>
              <KickoffPlaybookRow
                name={row.name}
                selected={row.name === selected}
                isDefault={row.name === lastUsed}
                onSelect={() => {
                  onSelect(row.name);
                  setOpen(false);
                }}
              />
              {index === seedRows.length - 1 && restRows.length > 0 && (
                <div
                  aria-hidden="true"
                  style={{ borderTop: "1px solid var(--border)" }}
                />
              )}
            </div>
          ))}
          {invalidRows.map((row) => (
            <KickoffPlaybookRow
              key={`invalid-${row.name}`}
              name={row.name}
              selected={false}
              isDefault={row.name === lastUsed}
              reason={row.reason}
              onSelect={() => {}}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface RepoRowProps {
  repo: DiscoveredRepo;
  checked: boolean;
  base: string;
  onToggle: () => void;
  onBaseChange: (base: string) => void;
}

function RepoRow({
  repo,
  checked,
  base,
  onToggle,
  onBaseChange,
}: RepoRowProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(base);
  const draftRef = useRef(base);
  const [checkFocus, setCheckFocus] = useState(false);
  const [chipFocus, setChipFocus] = useState(false);
  const [chipHover, setChipHover] = useState(false);

  function startEdit() {
    setDraft(base);
    draftRef.current = base;
    setEditing(true);
  }

  function commit() {
    onBaseChange(draftRef.current);
    setEditing(false);
  }

  function cancel() {
    draftRef.current = base;
    setDraft(base);
    setEditing(false);
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-sm)",
      }}
    >
      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-sm)",
          flex: "1 1 auto",
          minWidth: 0,
          cursor: "pointer",
        }}
      >
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          onFocus={(e) =>
            setCheckFocus(e.currentTarget.matches(":focus-visible"))
          }
          onBlur={() => setCheckFocus(false)}
          style={{
            accentColor: "var(--accent)",
            borderRadius: "var(--radius)",
            outline: "none",
            boxShadow: focusRing(checkFocus),
            flex: "0 0 auto",
          }}
        />
        <span
          style={{
            fontSize: "var(--font-body)",
            lineHeight: "var(--line-body)",
            color: "var(--text)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {repo.name}
        </span>
      </label>
      <div style={{ marginLeft: "auto", flex: "0 0 auto" }}>
        {editing ? (
          <input
            ref={(el) => {
              if (el && document.activeElement !== el) el.focus();
            }}
            value={draft}
            aria-label={`Edit base branch for ${repo.name}`}
            onChange={(e) => {
              setDraft(e.target.value);
              draftRef.current = e.target.value;
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit();
              } else if (e.key === "Escape") {
                e.preventDefault();
                cancel();
              }
            }}
            onFocus={() => setChipFocus(true)}
            onBlur={commit}
            style={{
              height: "24px",
              padding: "0 var(--space-sm)",
              background: "var(--surface-card)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
              fontFamily: "var(--font-mono)",
              fontSize: "var(--font-label)",
              color: "var(--text)",
              outline: "none",
              boxShadow: focusRing(chipFocus),
            }}
          />
        ) : (
          <button
            type="button"
            aria-label={`Edit base branch for ${repo.name}`}
            onClick={startEdit}
            onMouseEnter={() => setChipHover(true)}
            onMouseLeave={() => setChipHover(false)}
            onFocus={(e) =>
              setChipFocus(e.currentTarget.matches(":focus-visible"))
            }
            onBlur={() => setChipFocus(false)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "var(--space-xs)",
              height: "24px",
              padding: "0 var(--space-sm)",
              background: chipHover
                ? "var(--surface-card-hover)"
                : "var(--surface-card)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
              fontFamily: "var(--font-mono)",
              fontSize: "var(--font-label)",
              color: "var(--text-muted)",
              cursor: "pointer",
              outline: "none",
              boxShadow: focusRing(chipFocus),
            }}
          >
            {base}
          </button>
        )}
      </div>
    </div>
  );
}

interface EditInSettingsLinkProps {
  onClick: () => void;
}

function EditInSettingsLink({ onClick }: EditInSettingsLinkProps) {
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
        padding: 0,
        background: "transparent",
        border: "none",
        color: hover || focus ? "var(--text)" : "var(--text-muted)",
        fontFamily: "var(--font-ui)",
        fontSize: "var(--font-label)",
        lineHeight: "var(--line-label)",
        cursor: "pointer",
        outline: "none",
        boxShadow: focusRing(focus),
      }}
    >
      Edit in Settings
    </button>
  );
}

interface WorkspacePicker {
  folders: string[];
  selectedFolder: string | null;
  lastUsed: string | null;
  repos: DiscoveredRepo[] | null;
  checked: Record<string, boolean>;
  baseOverride: Record<string, string>;
  setChecked: (
    updater: (prev: Record<string, boolean>) => Record<string, boolean>,
  ) => void;
  setBaseOverride: (
    updater: (prev: Record<string, string>) => Record<string, string>,
  ) => void;
  selectFolder: (path: string) => Promise<void>;
  addFolder: (path: string) => Promise<string | null>;
  removeFolder: (path: string) => void;
}

function useWorkspacePicker(onInteraction: () => void): WorkspacePicker {
  const [folders, setFolders] = useState<string[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [lastUsed, setLastUsed] = useState<string | null>(null);
  const [repos, setRepos] = useState<DiscoveredRepo[] | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [baseOverride, setBaseOverride] = useState<Record<string, string>>({});

  const applyRepos = useCallback(
    (list: DiscoveredRepo[]) => {
      setRepos(list);
      setChecked(Object.fromEntries(list.map((r) => [r.path, true])));
      setBaseOverride({});
      onInteraction();
    },
    [onInteraction],
  );

  const selectGenRef = useRef(0);
  const selectFolder = useCallback(
    async (path: string) => {
      const gen = ++selectGenRef.current;
      setSelectedFolder(path);
      setRepos(null);
      try {
        const { repos: rs } = await discoverFolder(path);
        if (selectGenRef.current !== gen) return;
        applyRepos(rs);
      } catch (err) {
        if (selectGenRef.current !== gen) return;
        console.error("discoverFolder failed", err);
        applyRepos([]);
      }
    },
    [applyRepos],
  );

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const { folders: fs, lastUsed: lu } = await getWorkspaceFolders();
        if (!active) return;
        setFolders(fs);
        setLastUsed(lu);
        const initial = lu && fs.includes(lu) ? lu : (fs[0] ?? null);
        setSelectedFolder(initial);
        if (initial) {
          const gen = ++selectGenRef.current;
          const { repos: rs } = await discoverFolder(initial);
          if (!active || selectGenRef.current !== gen) return;
          applyRepos(rs);
        }
      } catch (err) {
        console.error("workspace load failed", err);
      }
    })();
    return () => {
      active = false;
    };
  }, [applyRepos]);

  const addFolder = useCallback(
    async (path: string): Promise<string | null> => {
      const gen = ++selectGenRef.current;
      try {
        const result = await addWorkspaceFolder(path);
        if (!result.ok) return result.error;
        setFolders((prev) => (prev.includes(path) ? prev : [...prev, path]));
        if (selectGenRef.current === gen) {
          setSelectedFolder(path);
          applyRepos(result.repos);
        }
        return null;
      } catch (err) {
        console.error("addWorkspaceFolder failed", err);
        return "Couldn't reach the server. Try again.";
      }
    },
    [applyRepos],
  );

  const removeFolder = useCallback(
    (path: string) => {
      removeWorkspaceFolder(path).catch((err) => {
        console.error("removeWorkspaceFolder failed", err);
      });
      const remaining = folders.filter((f) => f !== path);
      setFolders(remaining);
      if (path !== selectedFolder) return;
      const fallback =
        lastUsed && remaining.includes(lastUsed)
          ? lastUsed
          : (remaining[0] ?? null);
      if (fallback) {
        void selectFolder(fallback);
      } else {
        setSelectedFolder(null);
        setRepos(null);
      }
    },
    [folders, selectedFolder, lastUsed, selectFolder],
  );

  return {
    folders,
    selectedFolder,
    lastUsed,
    repos,
    checked,
    baseOverride,
    setChecked,
    setBaseOverride,
    selectFolder,
    addFolder,
    removeFolder,
  };
}

interface WorkspacePickerSectionProps {
  workspace: WorkspacePicker;
  onInteraction: () => void;
}

function WorkspacePickerSection({
  workspace,
  onInteraction,
}: WorkspacePickerSectionProps) {
  const {
    folders,
    selectedFolder,
    repos,
    checked,
    baseOverride,
    selectFolder,
    addFolder,
    removeFolder,
    setChecked,
    setBaseOverride,
  } = workspace;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-lg)",
        flex: "0 0 auto",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-xs)",
        }}
      >
        <Field>Workspace</Field>
        <FolderPicker
          folders={folders}
          selected={selectedFolder}
          onSelect={(p) => void selectFolder(p)}
          onRemove={removeFolder}
          onAdd={addFolder}
        />
      </div>

      {selectedFolder !== null && repos !== null && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-xs)",
          }}
        >
          <Field>Repositories</Field>
          {repos.length === 0 ? (
            <div
              style={{
                fontSize: "var(--font-label)",
                fontWeight: "var(--weight-semibold)",
                lineHeight: "var(--line-label)",
                color: "var(--text-muted)",
              }}
            >
              No git repositories found in this folder
            </div>
          ) : (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-sm)",
              }}
            >
              {repos.map((r) => (
                <RepoRow
                  key={r.path}
                  repo={r}
                  checked={checked[r.path] ?? false}
                  base={baseOverride[r.path] ?? r.base}
                  onToggle={() => {
                    onInteraction();
                    setChecked((prev) => ({
                      ...prev,
                      [r.path]: !prev[r.path],
                    }));
                  }}
                  onBaseChange={(b) => {
                    onInteraction();
                    setBaseOverride((prev) => ({ ...prev, [r.path]: b }));
                  }}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface PlaybookPicker {
  pickerValid: Playbook[];
  pickerInvalid: InvalidPlaybook[];
  lastUsedPlaybook: string | null;
  selectedPlaybook: string | null;
  seedRows: PickerRow[];
  restRows: PickerRow[];
  playbookArg: string | undefined;
  selectPlaybook: (name: string) => void;
  reload: () => Promise<void>;
}

function usePlaybookPicker(onInteraction: () => void): PlaybookPicker {
  const [pickerValid, setPickerValid] = useState<Playbook[]>([]);
  const [pickerInvalid, setPickerInvalid] = useState<InvalidPlaybook[]>([]);
  const [lastUsedPlaybook, setLastUsedPlaybook] = useState<string | null>(null);
  const [selectedPlaybook, setSelectedPlaybook] = useState<string | null>(null);

  const pickerGenRef = useRef(0);
  const loadPickerPlaybooks = useCallback(async () => {
    const gen = ++pickerGenRef.current;
    try {
      const { valid, invalid, lastUsed } = await getPickerPlaybooks();
      if (pickerGenRef.current !== gen) return;
      setPickerValid(valid);
      setPickerInvalid(invalid);
      setLastUsedPlaybook(lastUsed);

      const validNames = new Set(valid.map((p) => p.name));
      const seedRows = orderSeedRows(valid);
      const orderedNames = [
        ...seedRows.map((p) => p.name),
        ...valid.filter((p) => !seedRows.includes(p)).map((p) => p.name),
      ];
      if (lastUsed !== null && validNames.has(lastUsed)) {
        setSelectedPlaybook(lastUsed);
      } else if (validNames.has(WRITE_CODE_DIRECTLY_NAME)) {
        setSelectedPlaybook(WRITE_CODE_DIRECTLY_NAME);
      } else {
        setSelectedPlaybook(orderedNames[0] ?? null);
      }
    } catch (err) {
      console.error("getPickerPlaybooks failed", err);
      if (pickerGenRef.current !== gen) return;
      setPickerValid([]);
      setPickerInvalid([]);
      setLastUsedPlaybook(null);
      setSelectedPlaybook(null);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await loadPickerPlaybooks();
    })();
  }, [loadPickerPlaybooks]);

  const selectPlaybook = useCallback(
    (name: string) => {
      setSelectedPlaybook(name);
      onInteraction();
    },
    [onInteraction],
  );

  const seedRows = orderSeedRows(pickerValid);
  const restRows = pickerValid.filter((p) => !seedRows.includes(p));
  const playbookArg = selectedPlaybook ?? undefined;

  return {
    pickerValid,
    pickerInvalid,
    lastUsedPlaybook,
    selectedPlaybook,
    seedRows,
    restRows,
    playbookArg,
    selectPlaybook,
    reload: loadPickerPlaybooks,
  };
}

interface PlaybookPickerSectionProps {
  playbook: PlaybookPicker;
  onEditPlaybooks: () => void;
}

function PlaybookPickerSection({
  playbook,
  onEditPlaybooks,
}: PlaybookPickerSectionProps) {
  const {
    pickerInvalid,
    lastUsedPlaybook,
    selectedPlaybook,
    seedRows,
    restRows,
    selectPlaybook,
  } = playbook;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-xs)",
        flex: "0 0 auto",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Field>Playbook</Field>
        <EditInSettingsLink onClick={onEditPlaybooks} />
      </div>
      <KickoffPlaybookPicker
        seedRows={seedRows}
        restRows={restRows}
        invalidRows={pickerInvalid}
        selected={selectedPlaybook}
        lastUsed={lastUsedPlaybook}
        onSelect={selectPlaybook}
      />
      {seedRows.length === 0 && restRows.length === 0 && (
        <Notice tone="muted" label="No playbooks available">
          Starting without one. Manage playbooks in Settings ▸ Playbooks.
        </Notice>
      )}
    </div>
  );
}

export function StartModal({
  card,
  onClose,
  onEditPlaybooks,
}: StartModalProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const modalRef = useRef<ModalControl>(null);
  const [extraDirection, setExtraDirection] = useState(
    card.extraDirection ?? "",
  );
  const [error, setError] = useState<{
    text: string;
    variant: "config" | "playbook" | null;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [focused, setFocused] = useState<"textarea" | null>(null);

  const clearError = useCallback(() => setError(null), []);
  const workspace = useWorkspacePicker(clearError);
  const playbook = usePlaybookPicker(clearError);

  const { repos, checked, baseOverride, selectedFolder } = workspace;
  const { playbookArg, reload: reloadPlaybooks } = playbook;

  const checkedCount = (repos ?? []).filter((r) => checked[r.path]).length;
  const startDisabled =
    submitting ||
    error?.variant === "config" ||
    selectedFolder === null ||
    checkedCount === 0;

  async function handleStart() {
    if (startDisabled) return;
    setSubmitting(true);
    setError(null);
    try {
      const chosen = (repos ?? [])
        .filter((r) => checked[r.path])
        .map((r) => ({ path: r.path, base: baseOverride[r.path] ?? r.base }));
      const result = await startCard(
        card.id,
        extraDirection,
        selectedFolder ?? undefined,
        chosen,
        playbookArg,
      );
      if (result.ok) {
        modalRef.current?.requestClose();
        return;
      }
      if (result.variant === "playbook") {
        setError({
          text: "The selected playbook no longer exists.",
          variant: "playbook",
        });
        void reloadPlaybooks();
        return;
      }
      setError({
        text: result.error,
        variant: result.variant === "config" ? "config" : null,
      });
    } catch (err) {
      console.error("start failed", err);
      setError({
        text: "Couldn't reach the server. Try again.",
        variant: null,
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      ariaLabel="Start session"
      onClose={onClose}
      controlRef={modalRef}
      initialFocusRef={textareaRef}
      dialogStyle={{ maxHeight: "80vh" }}
    >
      <Modal.Header>{card.identifier}</Modal.Header>
      <Modal.Body>
        <WorkspacePickerSection
          workspace={workspace}
          onInteraction={clearError}
        />

        <PlaybookPickerSection
          playbook={playbook}
          onEditPlaybooks={onEditPlaybooks}
        />

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-sm)",
            flex: "0 0 auto",
          }}
        >
          <textarea
            ref={textareaRef}
            value={extraDirection}
            onChange={(e) => setExtraDirection(e.target.value)}
            onFocus={() => setFocused("textarea")}
            onBlur={() => setFocused(null)}
            aria-label="Prompt for Claude"
            placeholder="Optional direction for Claude — press Start to launch"
            style={{
              minHeight: "96px",
              resize: "vertical",
              padding: "var(--space-sm)",
              background: "var(--surface-card)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
              color: "var(--text)",
              fontFamily: "var(--font-ui)",
              fontSize: "var(--font-body)",
              lineHeight: "var(--line-body)",
              outline: "none",
              boxShadow:
                focused === "textarea" ? "0 0 0 2px var(--accent)" : "none",
            }}
          />
        </div>

        {error && (
          <div
            role="alert"
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-xs)",
              flex: "0 0 auto",
            }}
          >
            {error.variant === "config" ? (
              <>
                <Notice
                  tone="destructive"
                  label="Can't start — a selected repo is missing"
                />
                <div
                  style={{
                    fontSize: "var(--font-body)",
                    lineHeight: "var(--line-body)",
                    color: "var(--text-muted)",
                  }}
                >
                  One of the chosen repositories no longer exists on disk.
                  Reopen the workspace and re-pick.
                </div>
              </>
            ) : error.variant === "playbook" ? (
              <>
                <Notice
                  tone="destructive"
                  label="Can't start — that playbook is gone"
                />
                <div
                  style={{
                    fontSize: "var(--font-body)",
                    lineHeight: "var(--line-body)",
                    color: "var(--text-muted)",
                  }}
                >
                  The selected playbook was deleted. The list has refreshed —
                  pick another and press Start again.
                </div>
              </>
            ) : (
              <div
                style={{
                  fontSize: "var(--font-body)",
                  lineHeight: "var(--line-body)",
                  color: "var(--destructive)",
                }}
              >
                {error.text}
              </div>
            )}
          </div>
        )}
      </Modal.Body>
      <Modal.Actions>
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            flex: "0 0 auto",
          }}
        >
          <Button
            variant="primary"
            onClick={handleStart}
            disabled={startDisabled}
          >
            Start
          </Button>
        </div>
      </Modal.Actions>
    </Modal>
  );
}

StartModal.WorkspacePicker = WorkspacePickerSection;
StartModal.PlaybookPicker = PlaybookPickerSection;
