import type { Playbook } from "../../../../shared/types.js";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ErrorAlert } from "@/components/ErrorAlert";
import { PlaybookRow } from "./PlaybookRow";

interface PlaybooksListProps {
  playbooks: Playbook[] | null;
  loading: boolean;
  loadError: boolean;
  duplicateError: boolean;
  onEdit: (playbook: Playbook) => void;
  onDuplicate: (playbook: Playbook) => void;
  onDelete: (playbook: Playbook) => void;
}

export function PlaybooksList({
  playbooks,
  loading,
  loadError,
  duplicateError,
  onEdit,
  onDuplicate,
  onDelete,
}: PlaybooksListProps) {
  const ready = !loading && !loadError && playbooks !== null;
  return (
    <>
      {duplicateError && (
        <ErrorAlert>Couldn't duplicate playbook. Try again.</ErrorAlert>
      )}

      {loading && (
        <span className="text-sm font-semibold text-muted-foreground">
          Loading…
        </span>
      )}

      {!loading && loadError && (
        <ErrorAlert>
          Couldn't load playbooks. Reopen the page to retry.
        </ErrorAlert>
      )}

      {ready && playbooks.length === 0 && (
        <Alert variant="muted" role="status" className="mt-4">
          <AlertTitle>No playbooks yet</AlertTitle>
          <AlertDescription>
            Create one, or generate a draft with AI.
          </AlertDescription>
        </Alert>
      )}

      {ready && playbooks.length > 0 && (
        <div className="flex flex-col">
          {playbooks.map((p) => (
            <PlaybookRow
              key={p.slug ?? p.name}
              playbook={p}
              onEdit={() => onEdit(p)}
              onDuplicate={() => onDuplicate(p)}
              onDelete={() => onDelete(p)}
            />
          ))}
        </div>
      )}
    </>
  );
}
