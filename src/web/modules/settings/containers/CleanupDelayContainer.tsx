import { useState } from "react";
import { NumberSettingSection } from "@/components/NumberSettingSection";
import {
  CLEANUP_DELAY_MAX_DAYS,
  parseCleanupDelay,
} from "@/modules/settings/domain/cleanup-delay";
import { shouldSeedDraft } from "../../../../shared/draft-seed.js";
import {
  useCleanupDelayQuery,
  useSaveCleanupDelayMutation,
} from "@/modules/settings/queries/settings-queries";

interface CleanupDelayContainerProps {
  onSaved: () => void;
}

export function CleanupDelayContainer({ onSaved }: CleanupDelayContainerProps) {
  const query = useCleanupDelayQuery();
  const save = useSaveCleanupDelayMutation();
  const [draft, setDraft] = useState("");
  const [seeded, setSeeded] = useState<typeof query.data>();
  const [edited, setEdited] = useState(false);
  if (query.data && shouldSeedDraft(query.data, seeded, edited)) {
    setSeeded(query.data);
    setDraft(String(query.data.cleanupDelayDays));
  }
  const days = parseCleanupDelay(draft);

  const handleSave = () => {
    if (save.isPending || days === null) return;
    save.mutate(days, {
      onSuccess: (result) => {
        if (result.ok) onSaved();
      },
    });
  };

  return (
    <NumberSettingSection
      id="cleanup-delay"
      label="Cleanup delay (days)"
      ariaLabel="Cleanup delay in days"
      max={CLEANUP_DELAY_MAX_DAYS}
      hint="0 = clean up immediately when a card reaches Done."
      value={draft}
      invalid={days === null}
      invalidText="Enter a whole number between 0 and 90."
      loadErrorText={
        query.isError
          ? "Couldn't load the cleanup delay. Reopen settings to retry."
          : undefined
      }
      saveErrorText={
        save.isError || save.data?.ok === false
          ? "Couldn't save cleanup delay. Try again."
          : null
      }
      saveLabel="Save cleanup delay"
      saving={save.isPending}
      onChange={(value) => {
        setEdited(true);
        setDraft(value);
      }}
      onSave={handleSave}
    />
  );
}
