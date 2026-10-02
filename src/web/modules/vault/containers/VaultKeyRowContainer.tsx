import { useState } from "react";
import type { VaultKeySummary } from "../../../../shared/types.js";
import { VaultKeyRow } from "@/modules/vault/components/VaultKeyRow";
import { VaultPurposeEditor } from "@/modules/vault/components/VaultPurposeEditor";
import { VaultPreviousContainer } from "./VaultPreviousContainer";
import { VaultValueEditorContainer } from "./VaultValueEditorContainer";
import { vaultPurposeErrorCopy } from "@/modules/vault/domain/vault-copy";
import { purposeInputError } from "@/modules/vault/domain/vault-input";
import { useEditVaultPurposeMutation } from "@/modules/vault/queries/vault-queries";
import { useSingleFlight } from "@/queries/single-flight";

interface VaultKeyRowContainerProps {
  keySummary: VaultKeySummary;
  editingValue: boolean;
  editingPurpose: boolean;
  onOpenValueEditor: () => void;
  onCloseValueEditor: () => void;
  onOpenPurposeEditor: () => void;
  onClosePurposeEditor: () => void;
  onDelete: () => void;
}

export function VaultKeyRowContainer({
  keySummary,
  editingValue,
  editingPurpose,
  onOpenValueEditor,
  onCloseValueEditor,
  onOpenPurposeEditor,
  onClosePurposeEditor,
  onDelete,
}: VaultKeyRowContainerProps) {
  const savePurpose = useEditVaultPurposeMutation();
  const savePurposeOnce = useSingleFlight(savePurpose.mutate);
  const [draft, setDraft] = useState(keySummary.purpose);
  const [error, setError] = useState<string | null>(null);
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  const editorKey = editingPurpose ? keySummary.purpose : null;
  if (editorKey !== openedFor) {
    setOpenedFor(editorKey);
    setError(null);
    if (editorKey !== null) setDraft(editorKey);
  }

  const handleSave = () => {
    const purpose = draft.trim();
    const refused = purposeInputError(purpose);
    if (refused !== null) {
      setError(vaultPurposeErrorCopy(refused));
      return;
    }
    setError(null);
    savePurposeOnce(
      { name: keySummary.name, purpose },
      {
        onSuccess: (result) => {
          if (result.ok) onClosePurposeEditor();
          else setError(vaultPurposeErrorCopy(result.error));
        },
        onError: () => setError(vaultPurposeErrorCopy("fetch-failed")),
      },
    );
  };

  return (
    <VaultKeyRow
      keySummary={keySummary}
      purposeEditor={
        editingPurpose ? (
          <VaultPurposeEditor
            name={keySummary.name}
            draft={draft}
            pending={savePurpose.isPending}
            onChange={setDraft}
            onSave={handleSave}
            onCancel={onClosePurposeEditor}
          />
        ) : null
      }
      purposeError={error}
      previous={
        keySummary.hasPrevious ? (
          <VaultPreviousContainer
            key={keySummary.updatedAt}
            name={keySummary.name}
          />
        ) : null
      }
      valueEditor={
        editingValue ? (
          <VaultValueEditorContainer
            keySummary={keySummary}
            onClose={onCloseValueEditor}
          />
        ) : null
      }
      onOpenValueEditor={onOpenValueEditor}
      onOpenPurposeEditor={onOpenPurposeEditor}
      onDelete={onDelete}
    />
  );
}
