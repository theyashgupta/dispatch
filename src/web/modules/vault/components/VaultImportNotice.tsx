import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ErrorAlert } from "@/components/ErrorAlert";

export type VaultImportOutcome =
  { ok: true; imported: string[]; skipped: string[] } | { ok: false } | null;

interface VaultImportNoticeProps {
  outcome: VaultImportOutcome;
}

export function VaultImportNotice({ outcome }: VaultImportNoticeProps) {
  if (outcome === null) return null;
  if (!outcome.ok) {
    return (
      <ErrorAlert>
        Couldn't import from env-vault, reopen the page to retry.
      </ErrorAlert>
    );
  }
  const { imported, skipped } = outcome;
  if (imported.length === 0 && skipped.length === 0) {
    return (
      <Alert role="status">
        <AlertTitle>Nothing to import, all keys are already here.</AlertTitle>
      </Alert>
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
    <Alert role="status">
      <AlertTitle>{importedLine ?? skippedLine}</AlertTitle>
      {importedLine !== null && skippedLine !== null && (
        <AlertDescription>{skippedLine}</AlertDescription>
      )}
    </Alert>
  );
}
