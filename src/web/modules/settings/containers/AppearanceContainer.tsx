import { useState } from "react";
import type { ThemePreference } from "../../../../shared/theme.js";
import type { TerminalAppearance } from "../../../../shared/types.js";
import {
  DEFAULT_TERMINAL_APPEARANCE,
  validateTerminalAppearance,
} from "../../../../shared/terminal-appearance.js";
import { LoadingButton } from "@/components/LoadingButton";
import { AppearanceSection } from "@/modules/settings/components/AppearanceSection";
import { SettingsPanelLayout } from "@/components/SettingsPanelLayout";
import { shouldSeedDraft } from "@/modules/settings/domain/draft-seed";
import {
  useSaveTerminalAppearanceMutation,
  useTerminalAppearanceQuery,
} from "@/modules/settings/queries/settings-queries";

interface AppearanceContainerProps {
  themePreference: ThemePreference;
  onThemePreferenceChange: (preference: ThemePreference) => void;
  onSaved: () => void;
}

type TerminalDraft = Omit<TerminalAppearance, "fontSize">;

export function AppearanceContainer({
  themePreference,
  onThemePreferenceChange,
  onSaved,
}: AppearanceContainerProps) {
  const query = useTerminalAppearanceQuery();
  const save = useSaveTerminalAppearanceMutation();
  const [draft, setDraft] = useState<TerminalDraft>(
    DEFAULT_TERMINAL_APPEARANCE,
  );
  const [draftFontSize, setDraftFontSize] = useState(
    String(DEFAULT_TERMINAL_APPEARANCE.fontSize),
  );
  const [seeded, setSeeded] = useState<typeof query.data>();
  const [edited, setEdited] = useState(false);
  const read = query.data ? validateTerminalAppearance(query.data) : undefined;
  if (shouldSeedDraft(query.data, seeded, edited)) {
    setSeeded(query.data);
    if (read?.ok) {
      setDraft(read.value);
      setDraftFontSize(String(read.value.fontSize));
    }
  }
  const loaded = read?.ok === true;

  const validation = validateTerminalAppearance({
    ...draft,
    fontSize: Number(draftFontSize.trim()),
  });
  const validationError = validation.ok ? null : validation.error;

  const handleSave = () => {
    if (save.isPending || !validation.ok) return;
    save.mutate(validation.value, {
      onSuccess: (result) => {
        if (result.ok) onSaved();
      },
    });
  };

  let saveError: string | null = null;
  if (save.data?.ok === false) saveError = save.data.error;
  else if (save.isError) {
    saveError = "Couldn't save terminal appearance. Try again.";
  }

  return (
    <SettingsPanelLayout
      footer={
        <LoadingButton
          onClick={handleSave}
          disabled={!loaded || validationError !== null}
          loading={save.isPending}
        >
          {save.isPending ? "Saving…" : "Save terminal appearance"}
        </LoadingButton>
      }
    >
      <AppearanceSection
        preference={themePreference}
        draft={draft}
        draftFontSize={draftFontSize}
        loadError={query.isError || read?.ok === false}
        validationError={validationError}
        saveError={saveError}
        onPreferenceChange={onThemePreferenceChange}
        onColorChange={(key, value) => {
          setEdited(true);
          setDraft((prev) => ({ ...prev, [key]: value }));
        }}
        onFontFamilyChange={(fontFamily) => {
          setEdited(true);
          setDraft((prev) => ({ ...prev, fontFamily }));
        }}
        onFontSizeChange={(value) => {
          setEdited(true);
          setDraftFontSize(value);
        }}
      />
    </SettingsPanelLayout>
  );
}
