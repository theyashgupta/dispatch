import {
  useEffect,
  useState,
  type CSSProperties,
  type Dispatch,
  type SetStateAction,
} from "react";
import { Bot, RotateCcw } from "lucide-react";
import {
  ARCHIVE_RETENTION_MAX_DAYS,
  DEFAULT_CLAUDE_ARGS,
} from "../../../shared/types.js";
import {
  getArchiveRetention,
  getCleanupDelay,
  getClaudeArgs,
  saveArchiveRetention,
  saveCleanupDelay,
  saveClaudeArgs,
} from "../../lib/api.js";
import { Button } from "../../primitives/Button.js";
import { Field } from "../../primitives/Field.js";
import { focusRing } from "../../primitives/focus-ring.js";
import { Notice } from "../../primitives/Notice.js";
import { parseArchiveRetention } from "../archive/index.js";
import { settingsInputStyle } from "./settings-styles.js";

interface ModelsTab {
  draftArgs: string;
  setDraftArgs: Dispatch<SetStateAction<string>>;
  loaded: boolean;
  saving: boolean;
  saveError: boolean;
  loadError: boolean;
  handleSave: () => Promise<void>;
}

export function useModelsTab(onSaved: () => void): ModelsTab {
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
          Couldn't load Claude's launch arguments. Reopen settings to retry.
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
            label="Couldn't save Claude's arguments. Try again."
          />
        )}
      </div>
    </>
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

export function useCleanupTab(onSaved: () => void): CleanupTab {
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
          Couldn't load the cleanup delay. Reopen settings to retry.
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
            ...settingsInputStyle,
            width: "96px",
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
              color: "var(--destructive-text)",
            }}
          >
            Enter a whole number between 0 and 90.
          </div>
        )}
        {saveError && (
          <Notice
            tone="destructive"
            label="Couldn't save cleanup delay. Try again."
          />
        )}
      </div>
    </>
  );
}

interface RetentionTab {
  draftDays: string;
  setDraftDays: Dispatch<SetStateAction<string>>;
  parsedDays: number | null;
  saving: boolean;
  saveError: string | null;
  loadError: boolean;
  handleSave: () => Promise<void>;
}

export function useRetentionTab(onSaved: () => void): RetentionTab {
  const [draftDays, setDraftDays] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const { archiveRetentionDays } = await getArchiveRetention();
        if (!active) return;
        setDraftDays(String(archiveRetentionDays));
      } catch (err) {
        console.error("getArchiveRetention failed", err);
        if (!active) return;
        setLoadError(true);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const parsedDays = parseArchiveRetention(draftDays);

  async function handleSave() {
    if (saving || parsedDays === null) return;
    setSaving(true);
    setSaveError(null);
    try {
      const result = await saveArchiveRetention(parsedDays);
      if (result.ok) {
        onSaved();
        return;
      }
      setSaveError(result.error);
    } catch (err) {
      console.error("saveArchiveRetention failed", err);
      setSaveError("Couldn't save archive retention. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return {
    draftDays,
    setDraftDays,
    parsedDays,
    saving,
    saveError,
    loadError,
    handleSave,
  };
}

interface RetentionTabSectionProps {
  retentionTab: RetentionTab;
}

function RetentionTabSection({ retentionTab }: RetentionTabSectionProps) {
  const { draftDays, setDraftDays, parsedDays, saveError, loadError } =
    retentionTab;
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
          Couldn't load archive retention. Reopen settings to retry.
        </span>
      )}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-sm)",
        }}
      >
        <Field>Archive retention (days)</Field>
        <input
          type="number"
          min={0}
          max={ARCHIVE_RETENTION_MAX_DAYS}
          step={1}
          value={draftDays}
          onChange={(e) => setDraftDays(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          aria-label="Archive retention in days"
          style={{
            ...settingsInputStyle,
            width: "96px",
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
          Unwound groups keep their worktrees on disk until you delete them or
          this many days pass. 0 = never delete automatically.
        </span>
        {parsedDays === null && (
          <div
            role="alert"
            style={{
              fontSize: "var(--font-label)",
              fontWeight: "var(--weight-semibold)",
              lineHeight: "var(--line-label)",
              color: "var(--destructive-text)",
            }}
          >
            Enter a whole number between 0 and {ARCHIVE_RETENTION_MAX_DAYS}.
          </div>
        )}
        {saveError && <Notice tone="destructive" label={saveError} />}
      </div>
    </>
  );
}

const boardStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-xl)",
  flex: "1 1 auto",
  minHeight: 0,
  overflowY: "auto",
  padding: "var(--space-xs)",
};

const boardSectionStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-lg)",
};

interface BoardTabSectionProps {
  modelsTab: ModelsTab;
  cleanupTab: CleanupTab;
  retentionTab: RetentionTab;
}

export function BoardTabSection({
  modelsTab,
  cleanupTab,
  retentionTab,
}: BoardTabSectionProps) {
  return (
    <div className="scroll-stable-y" style={boardStyle}>
      <section style={boardSectionStyle}>
        <ModelsTabSection modelsTab={modelsTab} />
        <div>
          <Button
            variant="primary"
            onClick={() => void modelsTab.handleSave()}
            disabled={!modelsTab.loaded}
            loading={modelsTab.saving}
          >
            {modelsTab.saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </section>
      <section style={boardSectionStyle}>
        <CleanupTabSection cleanupTab={cleanupTab} />
        <div>
          <Button
            variant="primary"
            onClick={() => void cleanupTab.handleSave()}
            disabled={cleanupTab.validationError}
            loading={cleanupTab.saving}
          >
            {cleanupTab.saving ? "Saving…" : "Save cleanup delay"}
          </Button>
        </div>
      </section>
      <section style={boardSectionStyle}>
        <RetentionTabSection retentionTab={retentionTab} />
        <div>
          <Button
            variant="primary"
            onClick={() => void retentionTab.handleSave()}
            disabled={retentionTab.parsedDays === null}
            loading={retentionTab.saving}
          >
            {retentionTab.saving ? "Saving…" : "Save retention"}
          </Button>
        </div>
      </section>
    </div>
  );
}
