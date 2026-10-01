import { useState } from "react";
import { ARCHIVE_RETENTION_MAX_DAYS } from "../../../../shared/types.js";
import { parseArchiveRetention } from "../../../../shared/archive-retention.js";
import { NumberSettingSection } from "@/modules/settings/components/NumberSettingSection";
import { shouldSeedDraft } from "@/modules/settings/domain/draft-seed";
import {
  useArchiveRetentionQuery,
  useSaveArchiveRetentionMutation,
} from "@/queries/archive-retention-queries";

interface RetentionContainerProps {
  onSaved: () => void;
}

export function RetentionContainer({ onSaved }: RetentionContainerProps) {
  const query = useArchiveRetentionQuery();
  const save = useSaveArchiveRetentionMutation();
  const [draft, setDraft] = useState("");
  const [seeded, setSeeded] = useState<typeof query.data>();
  const [edited, setEdited] = useState(false);
  if (query.data && shouldSeedDraft(query.data, seeded, edited)) {
    setSeeded(query.data);
    setDraft(String(query.data.archiveRetentionDays));
  }
  const days = parseArchiveRetention(draft);

  const handleSave = () => {
    if (save.isPending || days === null) return;
    save.mutate(days, {
      onSuccess: (result) => {
        if (result.ok) onSaved();
      },
    });
  };

  let saveErrorText: string | null = null;
  if (save.data?.ok === false) saveErrorText = save.data.error;
  else if (save.isError) {
    saveErrorText = "Couldn't save archive retention. Try again.";
  }

  return (
    <NumberSettingSection
      id="archive-retention"
      label="Archive retention (days)"
      ariaLabel="Archive retention in days"
      max={ARCHIVE_RETENTION_MAX_DAYS}
      hint="Unwound groups keep their worktrees on disk until you delete them or this many days pass. 0 = never delete automatically."
      value={draft}
      invalid={days === null}
      invalidText={`Enter a whole number between 0 and ${ARCHIVE_RETENTION_MAX_DAYS}.`}
      loadError={query.isError}
      loadErrorText="Couldn't load archive retention. Reopen settings to retry."
      saveErrorText={saveErrorText}
      saveLabel="Save retention"
      saving={save.isPending}
      onChange={(value) => {
        setEdited(true);
        setDraft(value);
      }}
      onSave={handleSave}
    />
  );
}
