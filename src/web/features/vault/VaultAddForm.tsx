import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "../../primitives/Button.js";
import { Field } from "../../primitives/Field.js";
import type { VaultTab } from "./VaultPage.js";
import { focusRing } from "../../primitives/focus-ring.js";

interface VaultAddFormProps {
  vault: VaultTab;
}

export function VaultAddForm({ vault }: VaultAddFormProps) {
  const [nameFocused, setNameFocused] = useState(false);
  const [purposeFocused, setPurposeFocused] = useState(false);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-sm)",
        padding: "var(--space-lg)",
        background: "var(--surface-card)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
      }}
    >
      <div style={{ display: "flex", gap: "var(--space-sm)" }}>
        <div
          style={{
            flex: "1 1 auto",
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-xs)",
          }}
        >
          <Field>Name</Field>
          <input
            type="text"
            aria-label="New key name"
            placeholder="API_KEY"
            spellCheck={false}
            value={vault.addName}
            onChange={(e) => vault.setAddName(e.target.value)}
            onFocus={() => setNameFocused(true)}
            onBlur={() => setNameFocused(false)}
            style={{
              height: "32px",
              padding: "0 var(--space-sm)",
              background: "var(--surface-column)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
              color: "var(--text)",
              fontFamily: "var(--font-mono)",
              fontSize: "var(--font-body)",
              lineHeight: "var(--line-body)",
              ...focusRing(nameFocused),
            }}
          />
        </div>
        <div
          style={{
            flex: "1 1 auto",
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-xs)",
          }}
        >
          <Field>Purpose</Field>
          <input
            type="text"
            aria-label="New key purpose"
            placeholder="One-line purpose"
            value={vault.addPurpose}
            onChange={(e) => vault.setAddPurpose(e.target.value)}
            onFocus={() => setPurposeFocused(true)}
            onBlur={() => setPurposeFocused(false)}
            style={{
              height: "32px",
              padding: "0 var(--space-sm)",
              background: "var(--surface-column)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
              color: "var(--text)",
              fontFamily: "var(--font-ui)",
              fontSize: "var(--font-body)",
              lineHeight: "var(--line-body)",
              ...focusRing(purposeFocused),
            }}
          />
        </div>
      </div>
      {vault.addError !== null && (
        <div
          role="alert"
          style={{
            fontSize: "var(--font-label)",
            fontWeight: "var(--weight-semibold)",
            lineHeight: "var(--line-label)",
            color: "var(--destructive-text)",
          }}
        >
          {vault.addError}
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <Button
          variant="primary"
          loading={vault.addPending}
          onClick={() => void vault.handleAdd()}
        >
          <Plus size={14} strokeWidth={2} aria-hidden="true" />
          {vault.addPending ? "Adding..." : "Add key"}
        </Button>
      </div>
    </div>
  );
}
