import { useState } from "react";
import { VaultAddForm } from "@/modules/vault/components/VaultAddForm";
import { vaultAddErrorCopy } from "@/modules/vault/domain/vault-copy";
import { addKeyInputError } from "@/modules/vault/domain/vault-input";
import { useAddVaultKeyMutation } from "@/modules/vault/queries/vault-queries";
import { useSingleFlight } from "@/queries/single-flight";

export function VaultAddContainer() {
  const add = useAddVaultKeyMutation();
  const addOnce = useSingleFlight(add.mutate);
  const [addName, setAddName] = useState("");
  const [addPurpose, setAddPurpose] = useState("");
  const [addError, setAddError] = useState<string | null>(null);

  const handleAdd = () => {
    const name = addName.trim();
    const purpose = addPurpose.trim();
    const refused = addKeyInputError(name, purpose);
    if (refused !== null) {
      setAddError(vaultAddErrorCopy(refused));
      return;
    }
    setAddError(null);
    addOnce(
      { name, purpose },
      {
        onSuccess: (result) => {
          if (result.ok) {
            setAddName("");
            setAddPurpose("");
            return;
          }
          setAddError(vaultAddErrorCopy(result.error));
        },
        onError: () => setAddError(vaultAddErrorCopy("fetch-failed")),
      },
    );
  };

  return (
    <VaultAddForm
      name={addName}
      purpose={addPurpose}
      error={addError}
      pending={add.isPending}
      onNameChange={setAddName}
      onPurposeChange={setAddPurpose}
      onAdd={handleAdd}
    />
  );
}
