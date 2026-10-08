import { useState } from "react";
import type { VaultKeySummary } from "../../../../shared/types.js";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ErrorAlert } from "@/components/ErrorAlert";
import { PageHeaderCount } from "@/components/PageHeaderCount";
import { VaultKeyList } from "@/modules/vault/components/VaultKeyList";
import { VaultLayout } from "@/modules/vault/components/VaultLayout";
import { VaultLoading } from "@/modules/vault/components/VaultLoading";
import { VaultSearch } from "@/modules/vault/components/VaultSearch";
import { VaultSearchEmpty } from "@/modules/vault/components/VaultSearchEmpty";
import { VaultAddContainer } from "./VaultAddContainer";
import { VaultDeleteContainer } from "./VaultDeleteContainer";
import { VaultImportContainer } from "./VaultImportContainer";
import { VaultKeyRowContainer } from "./VaultKeyRowContainer";
import { useVaultKeysQuery } from "@/modules/vault/queries/vault-queries";

export function VaultContainer() {
  const list = useVaultKeysQuery();
  const [editing, setEditing] = useState<{
    name: string;
    kind: "value" | "purpose";
  } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<VaultKeySummary | null>(
    null,
  );
  const [search, setSearch] = useState("");

  const keys =
    list.data && !list.isError
      ? [...list.data.keys].sort((a, b) => a.name.localeCompare(b.name))
      : null;
  const query = search.trim().toLowerCase();
  const visible =
    keys === null || query === ""
      ? keys
      : keys.filter(
          (k) =>
            k.name.toLowerCase().includes(query) ||
            k.purpose.toLowerCase().includes(query),
        );

  return (
    <VaultLayout>
      <VaultAddContainer />
      <VaultImportContainer available={list.data?.envVaultAvailable === true} />
      {keys !== null && keys.length > 0 && (
        <VaultSearch value={search} onChange={setSearch} />
      )}
      {list.isPending && <VaultLoading />}
      {list.isError && (
        <ErrorAlert>
          Couldn't load vault keys, reopen the page to retry.
        </ErrorAlert>
      )}
      {keys !== null && keys.length === 0 && (
        <Alert role="status">
          <AlertTitle>No keys yet</AlertTitle>
          <AlertDescription>
            Add one above to store a secret Claude can use without ever reading
            it.
          </AlertDescription>
        </Alert>
      )}
      {keys !== null && keys.length > 0 && visible?.length === 0 && (
        <VaultSearchEmpty query={search.trim()} />
      )}
      {visible !== null && visible.length > 0 && (
        <VaultKeyList>
          {visible.map((k) => (
            <VaultKeyRowContainer
              key={k.name}
              keySummary={k}
              editingValue={
                editing?.name === k.name && editing.kind === "value"
              }
              editingPurpose={
                editing?.name === k.name && editing.kind === "purpose"
              }
              onOpenValueEditor={() =>
                setEditing({ name: k.name, kind: "value" })
              }
              onCloseValueEditor={() => setEditing(null)}
              onOpenPurposeEditor={() =>
                setEditing({ name: k.name, kind: "purpose" })
              }
              onClosePurposeEditor={() => setEditing(null)}
              onDelete={() => {
                setDeleteTarget(k);
                setEditing(null);
              }}
            />
          ))}
        </VaultKeyList>
      )}
      {deleteTarget && (
        <VaultDeleteContainer
          keySummary={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDeleted={() => {
            setDeleteTarget(null);
            setEditing(null);
          }}
        />
      )}
    </VaultLayout>
  );
}

export function VaultHeaderContainer() {
  const list = useVaultKeysQuery();
  const count = list.data && !list.isError ? list.data.keys.length : undefined;
  return count != null ? <PageHeaderCount count={count} /> : null;
}
