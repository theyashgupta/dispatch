import { useCallback, useEffect, useState } from "react";
import { Search } from "lucide-react";
import type { VaultKeySummary } from "../../../shared/types.js";
import {
  addVaultKey,
  getVaultKeys,
  importFromEnvVault,
} from "../../lib/api.js";
import { Button } from "../../primitives/Button.js";
import { Notice } from "../../primitives/Notice.js";
import { vaultAddErrorCopy } from "./vault-copy.js";
import { VAULT_NAME_RE } from "./vault-name.js";
import { PageBody } from "../../primitives/PageBody.js";
import { VaultDeleteConfirm } from "./VaultDeleteConfirm.js";
import { VaultImportConfirm } from "./VaultImportConfirm.js";
import { VaultKeyRow } from "./VaultKeyRow.js";
import { VaultAddForm } from "./VaultAddForm.js";
import { focusRing } from "../../primitives/focus-ring.js";

export type VaultImportOutcome =
  { ok: true; imported: string[]; skipped: string[] } | { ok: false } | null;

export interface VaultTab {
  keys: VaultKeySummary[] | null;
  loading: boolean;
  loadError: boolean;
  reload: () => Promise<void>;
  addName: string;
  setAddName: (v: string) => void;
  addPurpose: string;
  setAddPurpose: (v: string) => void;
  addError: string | null;
  addPending: boolean;
  handleAdd: () => Promise<void>;
  valueEditorFor: string | null;
  openValueEditor: (name: string) => void;
  closeValueEditor: () => void;
  purposeEditorFor: string | null;
  openPurposeEditor: (name: string) => void;
  closePurposeEditor: () => void;
  deleteTarget: VaultKeySummary | null;
  openDelete: (key: VaultKeySummary) => void;
  closeDelete: () => void;
  envVaultAvailable: boolean;
  importConfirmOpen: boolean;
  openImportConfirm: () => void;
  closeImportConfirm: () => void;
  importPending: boolean;
  handleImport: () => Promise<void>;
  importOutcome: VaultImportOutcome;
}

export function useVaultTab(): VaultTab {
  const [keys, setKeys] = useState<VaultKeySummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [addName, setAddName] = useState("");
  const [addPurpose, setAddPurpose] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [addPending, setAddPending] = useState(false);
  const [valueEditorFor, setValueEditorFor] = useState<string | null>(null);
  const [purposeEditorFor, setPurposeEditorFor] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<VaultKeySummary | null>(
    null,
  );
  const [envVaultAvailable, setEnvVaultAvailable] = useState(false);
  const [importConfirmOpen, setImportConfirmOpen] = useState(false);
  const [importPending, setImportPending] = useState(false);
  const [importOutcome, setImportOutcome] = useState<VaultImportOutcome>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const { keys: list, envVaultAvailable: available } = await getVaultKeys();
      setKeys([...list].sort((a, b) => a.name.localeCompare(b.name)));
      setEnvVaultAvailable(available);
    } catch (err) {
      console.error("getVaultKeys failed", err);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleAdd = useCallback(async () => {
    if (addPending) return;
    const name = addName.trim();
    const purpose = addPurpose.trim();
    if (!VAULT_NAME_RE.test(name)) {
      setAddError(vaultAddErrorCopy("invalid-name"));
      return;
    }
    if (purpose === "" || purpose.includes("\n") || purpose.length > 200) {
      setAddError(vaultAddErrorCopy("invalid-purpose"));
      return;
    }
    setAddPending(true);
    setAddError(null);
    try {
      const result = await addVaultKey({ name, purpose });
      if (result.ok) {
        setAddName("");
        setAddPurpose("");
        setAddError(null);
        await reload();
        return;
      }
      setAddError(vaultAddErrorCopy(result.error));
    } catch (err) {
      console.error("addVaultKey failed", err);
      setAddError(vaultAddErrorCopy("fetch-failed"));
    } finally {
      setAddPending(false);
    }
  }, [addPending, addName, addPurpose, reload]);

  const openValueEditor = useCallback((name: string) => {
    setValueEditorFor(name);
    setPurposeEditorFor(null);
  }, []);
  const closeValueEditor = useCallback(() => setValueEditorFor(null), []);

  const openPurposeEditor = useCallback((name: string) => {
    setPurposeEditorFor(name);
    setValueEditorFor(null);
  }, []);
  const closePurposeEditor = useCallback(() => setPurposeEditorFor(null), []);

  const openDelete = useCallback((key: VaultKeySummary) => {
    setDeleteTarget(key);
    setValueEditorFor(null);
    setPurposeEditorFor(null);
  }, []);
  const closeDelete = useCallback(() => setDeleteTarget(null), []);

  const openImportConfirm = useCallback(() => {
    setImportOutcome(null);
    setImportConfirmOpen(true);
  }, []);
  const closeImportConfirm = useCallback(() => setImportConfirmOpen(false), []);

  const handleImport = useCallback(async () => {
    if (importPending) return;
    setImportPending(true);
    try {
      const result = await importFromEnvVault();
      setImportConfirmOpen(false);
      if (result.ok) {
        setImportOutcome({
          ok: true,
          imported: result.imported,
          skipped: result.skipped,
        });
        await reload();
        return;
      }
      setImportOutcome({ ok: false });
    } catch (err) {
      console.error("importFromEnvVault failed", err);
      setImportConfirmOpen(false);
      setImportOutcome({ ok: false });
    } finally {
      setImportPending(false);
    }
  }, [importPending, reload]);

  return {
    keys,
    loading,
    loadError,
    reload,
    addName,
    setAddName,
    addPurpose,
    setAddPurpose,
    addError,
    addPending,
    handleAdd,
    valueEditorFor,
    openValueEditor,
    closeValueEditor,
    purposeEditorFor,
    openPurposeEditor,
    closePurposeEditor,
    deleteTarget,
    openDelete,
    closeDelete,
    envVaultAvailable,
    importConfirmOpen,
    openImportConfirm,
    closeImportConfirm,
    importPending,
    handleImport,
    importOutcome,
  };
}

interface VaultTabSectionProps {
  vaultTab: VaultTab;
}

interface VaultImportOutcomeNoticeProps {
  outcome: VaultImportOutcome;
}

function VaultImportOutcomeNotice({ outcome }: VaultImportOutcomeNoticeProps) {
  if (outcome === null) return null;
  if (!outcome.ok) {
    return (
      <Notice
        tone="destructive"
        label="Couldn't import from env-vault, reopen the page to retry."
      />
    );
  }
  const { imported, skipped } = outcome;
  if (imported.length === 0 && skipped.length === 0) {
    return (
      <div style={{ marginTop: "var(--space-lg)" }}>
        <Notice
          tone="muted"
          label="Nothing to import, all keys are already here."
        />
      </div>
    );
  }
  const importedLine =
    imported.length > 0
      ? `Imported ${imported.length} key(s): ${imported.join(", ")}`
      : null;
  const skippedLine =
    skipped.length > 0
      ? `Skipped ${skipped.length} already here: ${skipped.join(", ")}`
      : null;
  return (
    <div style={{ marginTop: "var(--space-lg)" }}>
      <Notice tone="muted" label={importedLine ?? skippedLine}>
        {importedLine !== null ? skippedLine : null}
      </Notice>
    </div>
  );
}

function VaultTabSection({ vaultTab }: VaultTabSectionProps) {
  const { keys, loading, loadError } = vaultTab;
  const [search, setSearch] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const query = search.trim().toLowerCase();
  const visible =
    keys === null
      ? null
      : query === ""
        ? keys
        : keys.filter(
            (k) =>
              k.name.toLowerCase().includes(query) ||
              k.purpose.toLowerCase().includes(query),
          );

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-lg)",
      }}
    >
      <VaultAddForm vault={vaultTab} />

      {vaultTab.envVaultAvailable && (
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <Button variant="secondary" onClick={vaultTab.openImportConfirm}>
            Import from env-vault
          </Button>
        </div>
      )}

      <VaultImportOutcomeNotice outcome={vaultTab.importOutcome} />

      {keys !== null && keys.length > 0 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-sm)",
            height: "32px",
            padding: "0 var(--space-sm)",
            background: "var(--surface-column)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            color: "var(--text-muted)",
            ...focusRing(searchFocused, true),
          }}
        >
          <Search size={14} strokeWidth={2} aria-hidden="true" />
          <input
            type="search"
            aria-label="Search keys"
            placeholder="Search by name or purpose"
            spellCheck={false}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            style={{
              flex: "1 1 auto",
              minWidth: 0,
              height: "100%",
              padding: 0,
              background: "transparent",
              border: "none",
              outline: "none",
              color: "var(--text)",
              fontFamily: "var(--font-ui)",
              fontSize: "var(--font-body)",
              lineHeight: "var(--line-body)",
            }}
          />
        </div>
      )}

      {loading && (
        <span
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "var(--font-label)",
            fontWeight: "var(--weight-semibold)",
            lineHeight: "var(--line-label)",
            color: "var(--text-muted)",
          }}
        >
          Loading…
        </span>
      )}

      {!loading && loadError && (
        <Notice
          tone="destructive"
          label="Couldn't load vault keys, reopen the page to retry."
        />
      )}

      {!loading && !loadError && keys !== null && keys.length === 0 && (
        <div style={{ marginTop: "var(--space-lg)" }}>
          <Notice tone="muted" label="No keys yet">
            Add one above to store a secret Claude can use without ever reading
            it.
          </Notice>
        </div>
      )}

      {!loading &&
        !loadError &&
        keys !== null &&
        keys.length > 0 &&
        visible !== null &&
        visible.length === 0 && (
          <span
            data-testid="vault-search-empty"
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: "var(--font-label)",
              lineHeight: "var(--line-label)",
              color: "var(--text-muted)",
            }}
          >
            No keys match "{search.trim()}".
          </span>
        )}

      {!loading && !loadError && visible !== null && visible.length > 0 && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-sm)",
          }}
        >
          {visible.map((k) => (
            <VaultKeyRow key={k.name} keySummary={k} vault={vaultTab} />
          ))}
        </div>
      )}
    </div>
  );
}

interface VaultPageProps {
  onCountChange: (count: number | undefined) => void;
}

export function VaultPage({ onCountChange }: VaultPageProps) {
  const vaultTab = useVaultTab();
  const { keys } = vaultTab;

  useEffect(() => {
    onCountChange(keys?.length);
  }, [keys?.length, onCountChange]);

  return (
    <PageBody>
      <VaultTabSection vaultTab={vaultTab} />
      {vaultTab.deleteTarget && (
        <VaultDeleteConfirm
          keySummary={vaultTab.deleteTarget}
          onClose={vaultTab.closeDelete}
          onDeleted={() => {
            vaultTab.closeDelete();
            vaultTab.closeValueEditor();
            vaultTab.closePurposeEditor();
            void vaultTab.reload();
          }}
        />
      )}
      {vaultTab.importConfirmOpen && <VaultImportConfirm vault={vaultTab} />}
    </PageBody>
  );
}
