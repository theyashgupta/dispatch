import { useState } from "react";
import { VaultImportButton } from "@/modules/vault/components/VaultImportButton";
import { VaultImportDialog } from "@/modules/vault/components/VaultImportDialog";
import {
  VaultImportNotice,
  type VaultImportOutcome,
} from "@/modules/vault/components/VaultImportNotice";
import { useImportFromEnvVaultMutation } from "@/modules/vault/queries/vault-queries";
import { useSingleFlight } from "@/queries/single-flight";

interface VaultImportContainerProps {
  available: boolean;
}

export function VaultImportContainer({ available }: VaultImportContainerProps) {
  const importKeys = useImportFromEnvVaultMutation();
  const importKeysOnce = useSingleFlight(importKeys.mutate);
  const [importOpen, setImportOpen] = useState(false);
  const [importOutcome, setImportOutcome] = useState<VaultImportOutcome>(null);

  const handleImport = () => {
    importKeysOnce(undefined, {
      onSuccess: (result) => {
        setImportOpen(false);
        setImportOutcome(
          result.ok
            ? { ok: true, imported: result.imported, skipped: result.skipped }
            : { ok: false },
        );
      },
      onError: () => {
        setImportOpen(false);
        setImportOutcome({ ok: false });
      },
    });
  };

  return (
    <>
      {available && (
        <VaultImportButton
          onClick={() => {
            setImportOutcome(null);
            setImportOpen(true);
          }}
        />
      )}
      <VaultImportNotice outcome={importOutcome} />
      {importOpen && (
        <VaultImportDialog
          pending={importKeys.isPending}
          onClose={() => setImportOpen(false)}
          onImport={handleImport}
        />
      )}
    </>
  );
}
