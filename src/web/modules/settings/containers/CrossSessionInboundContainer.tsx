import { useState } from "react";
import { CrossSessionInboundSection } from "@/modules/settings/components/CrossSessionInboundSection";
import { shouldSeedDraft } from "../../../../shared/draft-seed.js";
import {
  DEFAULT_CROSS_SESSION_INBOUND,
  type CrossSessionInbound,
} from "../../../../shared/types.js";
import {
  useCrossSessionInboundQuery,
  useSaveCrossSessionInboundMutation,
} from "@/modules/settings/queries/settings-queries";

interface CrossSessionInboundContainerProps {
  onSaved: () => void;
}

export function CrossSessionInboundContainer({
  onSaved,
}: CrossSessionInboundContainerProps) {
  const query = useCrossSessionInboundQuery();
  const save = useSaveCrossSessionInboundMutation();
  const [draft, setDraft] = useState<CrossSessionInbound>(
    DEFAULT_CROSS_SESSION_INBOUND,
  );
  const [seeded, setSeeded] = useState<typeof query.data>();
  const [edited, setEdited] = useState(false);
  if (query.data && shouldSeedDraft(query.data, seeded, edited)) {
    setSeeded(query.data);
    setDraft(query.data.crossSessionInbound);
  }
  const loaded = query.data !== undefined;

  const handleSave = () => {
    if (save.isPending || !loaded) return;
    save.mutate(draft, {
      onSuccess: (result) => {
        if (result.ok) onSaved();
      },
    });
  };

  return (
    <CrossSessionInboundSection
      draft={draft}
      loaded={loaded}
      saving={save.isPending}
      saveError={save.isError || save.data?.ok === false}
      loadError={query.isError}
      onDraftChange={(value) => {
        setEdited(true);
        setDraft(value);
      }}
      onSave={handleSave}
    />
  );
}
