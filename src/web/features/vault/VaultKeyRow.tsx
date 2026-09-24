import { useEffect, useState } from "react";
import { Check, Pencil, Trash2, X } from "lucide-react";
import type { VaultKeySummary } from "../../../shared/types.js";
import { editVaultPurpose } from "../../lib/api.js";
import { Button } from "../../primitives/Button.js";
import { Chip } from "../../primitives/Chip.js";
import { IconButton } from "../../primitives/IconButton.js";
import { vaultPurposeErrorCopy } from "./vault-copy.js";
import type { VaultTab } from "./VaultPage.js";
import { VaultValueEditor } from "./VaultValueEditor.js";
import { VaultPreviousValue } from "./VaultPreviousValue.js";
import { focusRing } from "../../primitives/focus-ring.js";

interface VaultKeyRowProps {
  keySummary: VaultKeySummary;
  vault: VaultTab;
}

export function VaultKeyRow({ keySummary, vault }: VaultKeyRowProps) {
  const [hover, setHover] = useState(false);
  const editingPurpose = vault.purposeEditorFor === keySummary.name;
  const usedBy = keySummary.usedBy ?? [];
  const [draftPurpose, setDraftPurpose] = useState(keySummary.purpose);
  const [purposeError, setPurposeError] = useState<string | null>(null);
  const [purposePending, setPurposePending] = useState(false);
  const [purposeFocused, setPurposeFocused] = useState(false);

  useEffect(() => {
    setPurposeError(null);
    if (editingPurpose) {
      setDraftPurpose(keySummary.purpose);
    }
  }, [editingPurpose, keySummary.purpose]);

  async function handleSavePurpose() {
    if (purposePending) return;
    const purpose = draftPurpose.trim();
    if (
      purpose === "" ||
      purpose.length > 200 ||
      purpose.includes("\n") ||
      purpose.includes("\r")
    ) {
      setPurposeError(vaultPurposeErrorCopy("invalid-purpose"));
      return;
    }
    setPurposePending(true);
    setPurposeError(null);
    try {
      const result = await editVaultPurpose(keySummary.name, purpose);
      if (result.ok) {
        vault.closePurposeEditor();
        void vault.reload();
        return;
      }
      setPurposeError(vaultPurposeErrorCopy(result.error));
    } catch (err) {
      console.error("editVaultPurpose failed", err);
      setPurposeError(vaultPurposeErrorCopy("fetch-failed"));
    } finally {
      setPurposePending(false);
    }
  }

  return (
    <div
      data-testid={`vault-row-${keySummary.name}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-sm)",
        padding: "var(--space-sm)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
        background: hover ? "var(--surface-card-hover)" : "var(--surface-card)",
        transition: "var(--hover-transition)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-sm)",
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
            whiteSpace: "normal",
            wordBreak: "break-all",
          }}
        >
          {keySummary.name}
        </span>
        <Chip tone={keySummary.filled ? "success" : "warning"}>
          {keySummary.filled ? "Filled" : "Empty"}
        </Chip>
        <Button
          variant="secondary"
          aria-label={
            keySummary.filled
              ? `Rotate value for ${keySummary.name}`
              : `Fill value for ${keySummary.name}`
          }
          onClick={() => vault.openValueEditor(keySummary.name)}
          style={{
            flex: "0 0 auto",
            height: "24px",
            padding: "0 var(--space-sm)",
            fontSize: "var(--font-label)",
          }}
        >
          {keySummary.filled ? "Rotate" : "Set value"}
        </Button>
        <IconButton
          aria-label={`Edit purpose for ${keySummary.name}`}
          onClick={() => vault.openPurposeEditor(keySummary.name)}
        >
          <Pencil size={14} strokeWidth={2} aria-hidden="true" />
        </IconButton>
        <IconButton
          aria-label={`Delete ${keySummary.name}`}
          onClick={() => vault.openDelete(keySummary)}
        >
          <Trash2 size={14} strokeWidth={2} aria-hidden="true" />
        </IconButton>
      </div>
      {editingPurpose ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-xs)",
          }}
        >
          <input
            type="text"
            aria-label={`Purpose for ${keySummary.name}`}
            value={draftPurpose}
            onChange={(e) => setDraftPurpose(e.target.value)}
            onFocus={() => setPurposeFocused(true)}
            onBlur={() => setPurposeFocused(false)}
            style={{
              flex: "1 1 auto",
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
          <IconButton
            aria-label={`Save purpose for ${keySummary.name}`}
            onClick={() => void handleSavePurpose()}
          >
            <Check size={14} strokeWidth={2} aria-hidden="true" />
          </IconButton>
          <IconButton
            aria-label={`Cancel purpose edit for ${keySummary.name}`}
            onClick={vault.closePurposeEditor}
          >
            <X size={14} strokeWidth={2} aria-hidden="true" />
          </IconButton>
        </div>
      ) : (
        <span
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "var(--font-label)",
            lineHeight: "var(--line-label)",
            color: "var(--text-muted)",
            whiteSpace: "normal",
            wordBreak: "break-word",
          }}
        >
          {keySummary.purpose}
        </span>
      )}
      {usedBy.length > 0 && (
        <span
          style={{
            fontSize: "var(--font-micro)",
            lineHeight: "var(--line-label)",
            color: "var(--text-muted)",
          }}
        >
          {`Used by ${usedBy.join(", ")}`}
        </span>
      )}
      {purposeError !== null && (
        <div
          role="alert"
          style={{
            fontSize: "var(--font-label)",
            fontWeight: "var(--weight-semibold)",
            lineHeight: "var(--line-label)",
            color: "var(--destructive-text)",
          }}
        >
          {purposeError}
        </div>
      )}
      {keySummary.hasPrevious && (
        <VaultPreviousValue
          key={keySummary.updatedAt}
          keySummary={keySummary}
        />
      )}
      {vault.valueEditorFor === keySummary.name && (
        <VaultValueEditor keySummary={keySummary} vault={vault} />
      )}
    </div>
  );
}
