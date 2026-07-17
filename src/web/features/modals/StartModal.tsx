import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, X } from "lucide-react";
import type {
  Card as CardModel,
  DiscoveredRepo,
  Playbook,
} from "../../../shared/types.js";
import {
  addWorkspaceFolder,
  discoverFolder,
  getPlaybooks,
  getWorkspaceFolders,
  removeWorkspaceFolder,
  sendKickoff,
  startCard,
} from "../../lib/api.js";
import { Button } from "../../primitives/Button.js";
import { Field } from "../../primitives/Field.js";
import { IconButton } from "../../primitives/IconButton.js";
import { Modal, type ModalControl } from "../../primitives/Modal.js";
import { Notice } from "../../primitives/Notice.js";
import { WorkspaceAdd } from "../workspaces/WorkspaceAdd.js";

interface StartModalProps {
  card: CardModel;
  stage: "planning" | "implementation";
  variant: "full" | "handoff";
  targetColumn: "in_planning" | "in_progress";
  onClose: () => void;
}

const PLAYBOOK_NONE = "None";

const PLAYBOOK_STAGE_DEFAULT: Record<"planning" | "implementation", string> = {
  planning: "Plan",
  implementation: "Code",
};

function playbookLastUsedKey(stage: "planning" | "implementation"): string {
  return `dispatch:playbook-last-used:${stage}`;
}

function readLastUsedPlaybook(
  stage: "planning" | "implementation",
): string | null {
  try {
    return localStorage.getItem(playbookLastUsedKey(stage));
  } catch {
    return null;
  }
}

function writeLastUsedPlaybook(
  stage: "planning" | "implementation",
  name: string,
): void {
  try {
    localStorage.setItem(playbookLastUsedKey(stage), name);
  } catch {}
}

const focusRing = (on: boolean): string =>
  on ? "0 0 0 2px var(--accent)" : "none";

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

interface PlaybookRowProps {
  name: string;
  muted?: boolean;
  onSelect: () => void;
}

function PlaybookRow({ name, muted, onSelect }: PlaybookRowProps) {
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  return (
    <button
      type="button"
      onClick={onSelect}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={(e) => setFocus(e.currentTarget.matches(":focus-visible"))}
      onBlur={() => setFocus(false)}
      style={{
        textAlign: "left",
        padding: "var(--space-sm)",
        background: hover ? "var(--surface-card-hover)" : "transparent",
        border: "none",
        borderRadius: "var(--radius)",
        color: muted ? "var(--text-muted)" : "var(--text)",
        fontFamily: "var(--font-ui)",
        fontSize: "var(--font-body)",
        lineHeight: "var(--line-body)",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        cursor: "pointer",
        outline: "none",
        boxShadow: focusRing(focus),
      }}
    >
      {name}
    </button>
  );
}

interface PlaybookPickerProps {
  names: string[];
  selected: string | null;
  onSelect: (name: string) => void;
}

function PlaybookPicker({ names, selected, onSelect }: PlaybookPickerProps) {
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
            color:
              selected === PLAYBOOK_NONE ? "var(--text-muted)" : "var(--text)",
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
          {names.map((name, index) => (
            <div key={name}>
              <PlaybookRow
                name={name}
                muted={name === PLAYBOOK_NONE}
                onSelect={() => {
                  onSelect(name);
                  setOpen(false);
                }}
              />
              {index === 0 && names.length > 1 && (
                <div
                  aria-hidden="true"
                  style={{ borderTop: "1px solid var(--border)" }}
                />
              )}
            </div>
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

export function StartModal({
  card,
  stage,
  variant,
  targetColumn,
  onClose,
}: StartModalProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const modalRef = useRef<ModalControl>(null);
  const [extraDirection, setExtraDirection] = useState(
    card.extraDirection ?? "",
  );
  const [error, setError] = useState<{
    text: string;
    isConfig: boolean;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [focused, setFocused] = useState<"textarea" | null>(null);

  const [playbooks, setPlaybooks] = useState<Playbook[]>([]);
  const [selectedPlaybook, setSelectedPlaybook] = useState<string | null>(null);

  const [folders, setFolders] = useState<string[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [lastUsed, setLastUsed] = useState<string | null>(null);
  const [repos, setRepos] = useState<DiscoveredRepo[] | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [baseOverride, setBaseOverride] = useState<Record<string, string>>({});

  const applyRepos = useCallback((list: DiscoveredRepo[]) => {
    setRepos(list);
    setChecked(Object.fromEntries(list.map((r) => [r.path, true])));
    setBaseOverride({});
    setError(null);
  }, []);

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
    if (variant !== "full") return;
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
  }, [applyRepos, variant]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const list = await getPlaybooks(stage);
        if (!active) return;
        const sorted = [...list].sort((a, b) => a.name.localeCompare(b.name));
        setPlaybooks(sorted);
        const names = sorted.map((p) => p.name);
        const stored = readLastUsedPlaybook(stage);
        if (
          stored !== null &&
          (stored === PLAYBOOK_NONE || names.includes(stored))
        ) {
          setSelectedPlaybook(stored);
          return;
        }
        const seededDefault = PLAYBOOK_STAGE_DEFAULT[stage];
        setSelectedPlaybook(
          names.includes(seededDefault) ? seededDefault : PLAYBOOK_NONE,
        );
      } catch (err) {
        console.error("getPlaybooks failed", err);
        if (!active) return;
        setPlaybooks([]);
        setSelectedPlaybook(PLAYBOOK_NONE);
      }
    })();
    return () => {
      active = false;
    };
  }, [stage]);

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

  const playbookNames = [PLAYBOOK_NONE, ...playbooks.map((p) => p.name)];
  const playbookArg =
    selectedPlaybook && selectedPlaybook !== PLAYBOOK_NONE
      ? selectedPlaybook
      : undefined;

  const selectPlaybook = useCallback(
    (name: string) => {
      writeLastUsedPlaybook(stage, name);
      setSelectedPlaybook(name);
    },
    [stage],
  );

  const checkedCount = (repos ?? []).filter((r) => checked[r.path]).length;
  const startDisabled =
    variant === "handoff"
      ? submitting
      : submitting ||
        (error?.isConfig ?? false) ||
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
      const result =
        variant === "handoff"
          ? await sendKickoff(card.id, {
              playbook: playbookArg,
              extra: extraDirection,
            })
          : await startCard(
              card.id,
              extraDirection,
              selectedFolder ?? undefined,
              chosen,
              playbookArg,
              targetColumn,
            );
      if (result.ok) {
        modalRef.current?.requestClose();
        return;
      }
      setError({
        text: result.error,
        isConfig: result.variant === "config",
      });
    } catch (err) {
      console.error("start failed", err);
      setError({
        text: "Couldn't reach the server. Try again.",
        isConfig: false,
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      ariaLabel="Start session"
      title={card.identifier}
      onClose={onClose}
      controlRef={modalRef}
      initialFocusRef={textareaRef}
      dialogStyle={{ maxHeight: "80vh" }}
      footer={
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
      }
    >
      {variant === "full" && (
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
                        setError(null);
                        setChecked((prev) => ({
                          ...prev,
                          [r.path]: !prev[r.path],
                        }));
                      }}
                      onBaseChange={(b) => {
                        setError(null);
                        setBaseOverride((prev) => ({ ...prev, [r.path]: b }));
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-xs)",
          flex: "0 0 auto",
        }}
      >
        <Field>Playbook</Field>
        <PlaybookPicker
          names={playbookNames}
          selected={selectedPlaybook ?? PLAYBOOK_NONE}
          onSelect={selectPlaybook}
        />
      </div>

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
          {error.isConfig ? (
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
                One of the chosen repositories no longer exists on disk. Reopen
                the workspace and re-pick.
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
    </Modal>
  );
}
