import { useState } from "react";
import { ClaudeArgsSection } from "@/modules/settings/components/ClaudeArgsSection";
import { shouldSeedDraft } from "../../../../shared/draft-seed.js";
import {
  useClaudeArgsQuery,
  useSaveClaudeArgsMutation,
} from "@/modules/settings/queries/settings-queries";

interface ClaudeArgsContainerProps {
  onSaved: () => void;
}

export function ClaudeArgsContainer({ onSaved }: ClaudeArgsContainerProps) {
  const query = useClaudeArgsQuery();
  const save = useSaveClaudeArgsMutation();
  const [draft, setDraft] = useState("");
  const [seeded, setSeeded] = useState<typeof query.data>();
  const [edited, setEdited] = useState(false);
  if (query.data && shouldSeedDraft(query.data, seeded, edited)) {
    setSeeded(query.data);
    setDraft(query.data.claudeArgs);
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
    <ClaudeArgsSection
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
