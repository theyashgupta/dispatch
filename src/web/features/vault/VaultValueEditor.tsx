import { useEffect, useState } from "react";
import type { VaultKeySummary } from "../../../shared/types.js";
import { getVaultValue, setVaultValue } from "../../lib/api.js";
import { Button } from "../../primitives/Button.js";
import { Field } from "../../primitives/Field.js";
import { vaultValueErrorCopy } from "./vault-copy.js";
import type { VaultTab } from "./VaultPage.js";
import { focusRing } from "../../primitives/focus-ring.js";

interface VaultValueEditorProps {
  keySummary: VaultKeySummary;
  vault: VaultTab;
}

export function VaultValueEditor({ keySummary, vault }: VaultValueEditorProps) {
  const [draftValue, setDraftValue] = useState("");
  const [valueError, setValueError] = useState<string | null>(null);
  const [savePending, setSavePending] = useState(false);
  const [focused, setFocused] = useState(false);
  const [currentValue, setCurrentValue] = useState<string | null>(null);
  const [currentError, setCurrentError] = useState(false);

  useEffect(() => {
    if (!keySummary.filled) return;
    let cancelled = false;
    getVaultValue(keySummary.name)
      .then((result) => {
        if (cancelled) return;
        if (result.ok) setCurrentValue(result.value);
        else setCurrentError(true);
      })
      .catch(() => {
        if (!cancelled) setCurrentError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [keySummary.name, keySummary.filled]);

  async function handleSaveValue() {
    if (savePending) return;
    const value = draftValue.trim();
    if (value === "") {
      setValueError(vaultValueErrorCopy("missing-value"));
      return;
    }
    if (
      value.includes("\n") ||
      value.includes("\r") ||
      new TextEncoder().encode(value).length > 8192
    ) {
      setValueError(vaultValueErrorCopy("invalid-value"));
      return;
    }
    setSavePending(true);
    setValueError(null);
    try {
      const result = await setVaultValue(keySummary.name, value);
      if (result.ok) {
        setDraftValue("");
        vault.closeValueEditor();
        void vault.reload();
        return;
      }
      setValueError(vaultValueErrorCopy(result.error));
    } catch (err) {
      console.error("setVaultValue failed", err);
      setValueError(vaultValueErrorCopy("fetch-failed"));
    } finally {
      setSavePending(false);
    }
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-sm)",
        padding: "var(--space-sm)",
        background: "var(--surface-column)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
      }}
    >
      {keySummary.filled && (
        <div
          data-testid={`vault-current-${keySummary.name}`}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-xs)",
          }}
        >
          <Field>Current value</Field>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "var(--font-label)",
              lineHeight: "var(--line-label)",
              color: currentError ? "var(--destructive-text)" : "var(--text)",
              whiteSpace: "normal",
              wordBreak: "break-all",
              userSelect: "text",
            }}
          >
            {currentError
              ? "Couldn't load the current value."
              : (currentValue ?? "Loading...")}
          </span>
        </div>
      )}
      <Field>{keySummary.filled ? "New value" : "Value"}</Field>
      <input
        type="text"
        autoComplete="new-password"
        spellCheck={false}
        data-1p-ignore
        data-lpignore="true"
        data-bwignore="true"
        value={draftValue}
        onChange={(e) => setDraftValue(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        aria-label={`Value for ${keySummary.name}`}
        style={{
          height: "32px",
          padding: "0 var(--space-sm)",
          background: "var(--surface-card)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          color: "var(--text)",
          fontFamily: "var(--font-mono)",
          fontSize: "var(--font-body)",
          lineHeight: "var(--line-body)",
          ...focusRing(focused),
        }}
      />
      {valueError !== null && (
        <div
          role="alert"
          style={{
            fontSize: "var(--font-label)",
            fontWeight: "var(--weight-semibold)",
            lineHeight: "var(--line-label)",
            color: "var(--destructive-text)",
          }}
        >
          {valueError}
        </div>
      )}
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: "var(--space-sm)",
        }}
      >
        <Button variant="secondary" onClick={vault.closeValueEditor}>
          Cancel edit
        </Button>
        <Button
          variant="primary"
          loading={savePending}
          onClick={() => void handleSaveValue()}
        >
          {savePending ? "Saving value..." : "Save value"}
        </Button>
      </div>
    </div>
  );
}
