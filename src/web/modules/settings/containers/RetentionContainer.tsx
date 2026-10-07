import { ARCHIVE_RETENTION_MAX_DAYS } from "../../../../shared/types.js";
import { NumberSettingSection } from "@/components/NumberSettingSection";
import { useArchiveRetentionDraft } from "@/queries/archive-retention-queries";

interface RetentionContainerProps {
  onSaved: () => void;
}

export function RetentionContainer({ onSaved }: RetentionContainerProps) {
  const retention = useArchiveRetentionDraft(onSaved);

  return (
    <NumberSettingSection
      id="archive-retention"
      label="Archive retention (days)"
      ariaLabel="Archive retention in days"
      max={ARCHIVE_RETENTION_MAX_DAYS}
      hint="Unwound groups keep their worktrees on disk until you delete them or this many days pass. 0 = never delete automatically."
      value={retention.draft}
      invalid={retention.invalid}
      invalidText={`Enter a whole number between 0 and ${ARCHIVE_RETENTION_MAX_DAYS}.`}
      loadErrorText={
        retention.loadError
          ? "Couldn't load archive retention. Reopen settings to retry."
          : undefined
      }
      saveErrorText={retention.saveErrorText}
      saveLabel="Save retention"
      saving={retention.saving}
      onChange={retention.change}
      onSave={retention.save}
    />
  );
}
