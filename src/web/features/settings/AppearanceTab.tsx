import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import type { TerminalAppearance } from "../../../shared/types.js";
import {
  DEFAULT_TERMINAL_APPEARANCE,
  TERMINAL_APPEARANCE_CHANNEL,
  TERMINAL_FONT_FAMILIES,
  TERMINAL_FONT_SIZE_MAX,
  TERMINAL_FONT_SIZE_MIN,
  validateTerminalAppearance,
} from "../../../shared/terminal-appearance.js";
import { FONT_FAMILY } from "../../../shared/nerd-font-mono.js";
import {
  detectInstalledFonts,
  fontOptionLabel,
} from "../../lib/terminal-fonts.js";
import {
  getTerminalAppearance,
  saveTerminalAppearance,
} from "../../lib/api.js";
import { Button } from "../../primitives/Button.js";
import { Field } from "../../primitives/Field.js";
import { focusRing } from "../../primitives/focus-ring.js";
import { Notice } from "../../primitives/Notice.js";
import { settingsInputStyle } from "./settings-styles.js";

type TerminalDraft = Omit<TerminalAppearance, "fontSize">;

interface TerminalTab {
  draft: TerminalDraft;
  draftFontSize: string;
  setField: <K extends keyof TerminalDraft>(
    key: K,
    value: TerminalDraft[K],
  ) => void;
  setDraftFontSize: Dispatch<SetStateAction<string>>;
  loaded: boolean;
  saving: boolean;
  saveError: string | null;
  loadError: boolean;
  validationError: string | null;
  handleSave: () => Promise<void>;
}

export function useTerminalTab(onSaved: () => void): TerminalTab {
  const [draft, setDraft] = useState<TerminalDraft>(
    DEFAULT_TERMINAL_APPEARANCE,
  );
  const [draftFontSize, setDraftFontSize] = useState(
    String(DEFAULT_TERMINAL_APPEARANCE.fontSize),
  );
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const result = validateTerminalAppearance(
          await getTerminalAppearance(),
        );
        if (!active) return;
        if (!result.ok) throw new Error(result.error);
        setDraft(result.value);
        setDraftFontSize(String(result.value.fontSize));
        setLoaded(true);
      } catch (err) {
        console.error("getTerminalAppearance failed", err);
        if (!active) return;
        setLoadError(true);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const candidate = { ...draft, fontSize: Number(draftFontSize.trim()) };
  const validation = validateTerminalAppearance(candidate);
  const validationError = validation.ok ? null : validation.error;

  function setField<K extends keyof TerminalDraft>(
    key: K,
    value: TerminalDraft[K],
  ) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    if (savingRef.current || !validation.ok) return;
    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    let saved = false;
    try {
      const result = await saveTerminalAppearance(validation.value);
      if (result.ok) saved = true;
      else setSaveError(result.error);
    } catch (err) {
      console.error("saveTerminalAppearance failed", err);
      setSaveError("Couldn't save terminal appearance. Try again.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
    if (!saved) return;
    if (typeof BroadcastChannel !== "undefined") {
      const channel = new BroadcastChannel(TERMINAL_APPEARANCE_CHANNEL);
      channel.postMessage(validation.value);
      channel.close();
    }
    onSaved();
  }

  return {
    draft,
    draftFontSize,
    setField,
    setDraftFontSize,
    loaded,
    saving,
    saveError,
    loadError,
    validationError,
    handleSave,
  };
}

const FONT_FAMILY_LABELS: Record<string, string> = {
  [FONT_FAMILY]: "JetBrains Mono Nerd Font (bundled)",
  monospace: "System monospace",
};

interface TerminalTabSectionProps {
  terminalTab: TerminalTab;
}

export function TerminalTabSection({ terminalTab }: TerminalTabSectionProps) {
  const {
    draft,
    draftFontSize,
    setField,
    setDraftFontSize,
    saveError,
    loadError,
    validationError,
  } = terminalTab;
  const [focused, setFocused] = useState<string | null>(null);
  const [installedFonts] = useState<Set<string>>(() =>
    detectInstalledFonts(TERMINAL_FONT_FAMILIES),
  );
  const field = (name: string) => ({
    onFocus: () => setFocused(name),
    onBlur: () => setFocused(null),
    style: { ...settingsInputStyle, ...focusRing(focused === name) },
  });
  const colorField = (key: "background" | "foreground" | "cursor") => {
    const f = field(key);
    return (
      <input
        type="color"
        value={draft[key]}
        onChange={(e) => setField(key, e.target.value)}
        aria-label={`Terminal ${key} color`}
        {...f}
        style={{ ...f.style, width: "64px", padding: "2px" }}
      />
    );
  };
  const row = (label: string, control: ReactNode, hint?: string) => (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-sm)",
      }}
    >
      <Field>{label}</Field>
      {control}
      {hint && (
        <span
          style={{
            fontSize: "var(--font-label)",
            lineHeight: "var(--line-label)",
            color: "var(--text-muted)",
          }}
        >
          {hint}
        </span>
      )}
    </div>
  );

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
          Couldn't load the terminal appearance. Reopen settings to retry.
        </span>
      )}
      {row("Background color", colorField("background"))}
      {row("Text color", colorField("foreground"))}
      {row("Cursor color", colorField("cursor"))}
      {row(
        "Font family",
        <select
          value={draft.fontFamily}
          onChange={(e) => setField("fontFamily", e.target.value)}
          aria-label="Terminal font family"
          {...field("fontFamily")}
          style={{
            ...field("fontFamily").style,
            width: "100%",
            maxWidth: "280px",
          }}
        >
          {TERMINAL_FONT_FAMILIES.map((name) => (
            <option key={name} value={name}>
              {fontOptionLabel(name, installedFonts, FONT_FAMILY_LABELS)}
            </option>
          ))}
        </select>,
        "Fonts marked not installed fall back to the bundled Nerd Font, which always stays as the fallback so Claude Code's glyphs keep rendering.",
      )}
      {row(
        "Font size (px)",
        <input
          type="number"
          min={TERMINAL_FONT_SIZE_MIN}
          max={TERMINAL_FONT_SIZE_MAX}
          step={1}
          value={draftFontSize}
          onChange={(e) => setDraftFontSize(e.target.value)}
          aria-label="Terminal font size in pixels"
          {...field("fontSize")}
          style={{
            ...field("fontSize").style,
            width: "96px",
            maxWidth: "100%",
          }}
        />,
      )}
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
          {validationError}
        </div>
      )}
      {saveError && <Notice tone="destructive" label={saveError} />}
    </>
  );
}

interface TerminalSaveButtonProps {
  terminalTab: TerminalTab;
}

export function TerminalSaveButton({ terminalTab }: TerminalSaveButtonProps) {
  return (
    <Button
      variant="primary"
      onClick={() => void terminalTab.handleSave()}
      disabled={!terminalTab.loaded || terminalTab.validationError !== null}
      loading={terminalTab.saving}
    >
      {terminalTab.saving ? "Saving…" : "Save terminal appearance"}
    </Button>
  );
}
