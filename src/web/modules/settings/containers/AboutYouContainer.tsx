import { useState } from "react";
import { AboutYouSection } from "@/modules/settings/components/AboutYouSection";
import { SettingsPanelLayout } from "@/components/SettingsPanelLayout";
import {
  toProfileDraft,
  type ProfileDraft,
} from "@/modules/settings/domain/profile-draft";
import { parseHandles } from "@/modules/settings/domain/profile-handles";
import { shouldSeedDraft } from "@/modules/settings/domain/draft-seed";
import {
  useProfileQuery,
  useSaveProfileMutation,
} from "@/modules/settings/queries/settings-queries";

interface AboutYouContainerProps {
  onSaved: () => void;
}

export function AboutYouContainer({ onSaved }: AboutYouContainerProps) {
  const query = useProfileQuery();
  const save = useSaveProfileMutation();
  const [draft, setDraft] = useState<ProfileDraft>(() => toProfileDraft({}));
  const [seeded, setSeeded] = useState<typeof query.data>();
  const [edited, setEdited] = useState(false);
  if (query.data && shouldSeedDraft(query.data, seeded, edited)) {
    setSeeded(query.data);
    setDraft(toProfileDraft(query.data));
  }
  const loaded = query.data !== undefined;

  const handleSave = () => {
    if (save.isPending || !loaded) return;
    save.mutate(
      { ...draft, handles: parseHandles(draft.handles) },
      {
        onSuccess: (result) => {
          if (result.ok) {
            setDraft(toProfileDraft(result.profile));
            setEdited(false);
            onSaved();
          }
        },
      },
    );
  };

  let saveError: string | null = null;
  if (save.data?.ok === false) saveError = save.data.error;
  else if (save.isError) saveError = "Couldn't save your profile. Try again.";

  return (
    <SettingsPanelLayout>
      <AboutYouSection
        draft={draft}
        loaded={loaded}
        saving={save.isPending}
        saveError={saveError}
        loadError={query.isError}
        onFieldChange={(key, value) => {
          setEdited(true);
          setDraft((prev) => ({ ...prev, [key]: value }));
        }}
        onSave={handleSave}
      />
    </SettingsPanelLayout>
  );
}
