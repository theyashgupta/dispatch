import { useState } from "react";
import { shouldSeedDraft } from "../../../../shared/draft-seed.js";
import {
  DEFAULT_USAGE_THRESHOLDS,
  type UsageThresholds,
} from "../../../../shared/usage-thresholds.js";
import { UsageThresholdsSection } from "@/modules/settings/components/UsageThresholdsSection";
import {
  parseUsageThresholdsDraft,
  usageThresholdsDraftFrom,
} from "@/modules/settings/domain/usage-thresholds-draft";
import {
  useSaveUsageThresholdsMutation,
  useUsageThresholdsQuery,
} from "@/queries/usage-thresholds-queries";

interface UsageThresholdsContainerProps {
  onSaved: () => void;
}

export function UsageThresholdsContainer({
  onSaved,
}: UsageThresholdsContainerProps) {
  const query = useUsageThresholdsQuery();
  const save = useSaveUsageThresholdsMutation();
  const [draft, setDraft] = useState(() =>
    usageThresholdsDraftFrom(DEFAULT_USAGE_THRESHOLDS),
  );
  const [seeded, setSeeded] = useState<typeof query.data>();
  const [edited, setEdited] = useState(false);
  if (query.data && shouldSeedDraft(query.data, seeded, edited)) {
    setSeeded(query.data);
    setDraft(usageThresholdsDraftFrom(query.data));
  }
  const loaded = query.data !== undefined;
  const parsed = parseUsageThresholdsDraft(draft);

  const submit = (thresholds: UsageThresholds) => {
    if (save.isPending || !loaded) return;
    save.mutate(thresholds, {
      onSuccess: (result) => {
        if (result.ok) onSaved();
      },
    });
  };

  const saveErrorText = save.isError
    ? "Couldn't save the usage thresholds. Try again."
    : save.data?.ok === false
      ? save.data.error
      : null;

  return (
    <UsageThresholdsSection
      draft={draft}
      loaded={loaded}
      saving={save.isPending}
      invalidText={parsed.ok ? null : parsed.error}
      saveErrorText={saveErrorText}
      loadError={query.isError}
      onFieldChange={(field, value) => {
        setEdited(true);
        setDraft((current) => ({ ...current, [field]: value }));
      }}
      onSave={() => {
        if (parsed.ok) submit(parsed.value);
      }}
      onReset={() => {
        setEdited(true);
        setDraft(usageThresholdsDraftFrom(DEFAULT_USAGE_THRESHOLDS));
        submit(DEFAULT_USAGE_THRESHOLDS);
      }}
    />
  );
}
