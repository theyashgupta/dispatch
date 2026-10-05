import { useState } from "react";
import type { VaultKeySummary } from "../../../../shared/types.js";
import { VaultValueEditor } from "@/modules/vault/components/VaultValueEditor";
import { vaultValueErrorCopy } from "@/modules/vault/domain/vault-copy";
import { valueInputError } from "@/modules/vault/domain/vault-input";
import {
  useSetVaultValueMutation,
  useVaultValueQuery,
} from "@/modules/vault/queries/vault-queries";
import { useSingleFlight } from "@/queries/single-flight";

interface VaultValueEditorContainerProps {
  keySummary: VaultKeySummary;
  onClose: () => void;
}

export function VaultValueEditorContainer({
  keySummary,
  onClose,
}: VaultValueEditorContainerProps) {
  const current = useVaultValueQuery(keySummary.name, keySummary.filled);
  const save = useSetVaultValueMutation();
  const saveOnce = useSingleFlight(save.mutate);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSave = () => {
    const value = draft.trim();
    const refused = valueInputError(value);
    if (refused !== null) {
      setError(vaultValueErrorCopy(refused));
      return;
    }
    setError(null);
    saveOnce(
      { name: keySummary.name, value },
      {
        onSuccess: (result) => {
          if (result.ok) {
            setDraft("");
            onClose();
            return;
          }
          setError(vaultValueErrorCopy(result.error));
        },
        onError: () => setError(vaultValueErrorCopy("fetch-failed")),
      },
    );
  };

  const read = current.data;
  return (
    <VaultValueEditor
      name={keySummary.name}
      filled={keySummary.filled}
      current={
        current.isError || read?.ok === false
          ? { state: "error" }
          : read?.ok
            ? { state: "ready", value: read.value }
            : { state: "loading" }
      }
      draft={draft}
      error={error}
      pending={save.isPending}
      onChange={setDraft}
      onCancel={onClose}
      onSave={handleSave}
    />
  );
}
