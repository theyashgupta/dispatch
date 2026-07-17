import { useState, type ReactNode } from "react";
import { Button } from "../../primitives/Button.js";
import { FolderBrowserModal } from "./FolderBrowserModal.js";

const focusRing = (on: boolean): string =>
  on ? "0 0 0 2px var(--accent)" : "none";

interface WorkspaceAddProps {
  onAdd: (path: string) => Promise<string | null>;
  onCancel?: () => void;
  hint?: ReactNode;
  fullWidthSubmit?: boolean;
}

export function WorkspaceAdd({
  onAdd,
  onCancel,
  hint,
  fullWidthSubmit,
}: WorkspaceAddProps) {
  const [value, setValue] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const [inputFocus, setInputFocus] = useState(false);

  const trimmed = value.trim();
  const canSubmit = trimmed !== "" && !submitting;

  async function submitAdd() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const err = await onAdd(trimmed);
      if (err === null) {
        setValue("");
        setValidationError(null);
      } else {
        setValidationError(err);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-sm)",
      }}
    >
      <div style={{ display: "flex", gap: "var(--space-sm)" }}>
        <Button variant="secondary" onClick={() => setBrowsing(true)}>
          Browse…
        </Button>
        <input
          value={value}
          placeholder="~/Work/project-folder"
          aria-label="Workspace folder path"
          onChange={(e) => {
            setValue(e.target.value);
            setValidationError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void submitAdd();
            } else if (e.key === "Escape") {
              setValidationError(null);
              if (onCancel) {
                e.preventDefault();
                onCancel();
              }
            }
          }}
          onFocus={() => setInputFocus(true)}
          onBlur={() => setInputFocus(false)}
          style={{
            flex: "1 1 auto",
            minWidth: 0,
            height: "32px",
            padding: "0 var(--space-sm)",
            background: "var(--surface-card)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            color: "var(--text)",
            fontFamily: "var(--font-mono)",
            fontSize: "var(--font-label)",
            lineHeight: "var(--line-label)",
            outline: "none",
            boxShadow: focusRing(inputFocus),
          }}
        />
      </div>

      {hint && validationError === null && (
        <div
          style={{
            fontSize: "var(--font-body)",
            lineHeight: "var(--line-body)",
            color: "var(--text-muted)",
          }}
        >
          {hint}
        </div>
      )}
      {validationError !== null && (
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

      <div
        style={{
          display: "flex",
          justifyContent: fullWidthSubmit ? "stretch" : "flex-end",
        }}
      >
        <Button
          variant="primary"
          style={fullWidthSubmit ? { width: "100%" } : undefined}
          disabled={!canSubmit}
          aria-busy={submitting}
          onClick={() => void submitAdd()}
        >
          {submitting ? "Adding…" : "Add workspace"}
        </Button>
      </div>

      {browsing && (
        <FolderBrowserModal
          onClose={() => setBrowsing(false)}
          onSelect={(path) => {
            setValue(path);
            setValidationError(null);
            setBrowsing(false);
          }}
        />
      )}
    </div>
  );
}
