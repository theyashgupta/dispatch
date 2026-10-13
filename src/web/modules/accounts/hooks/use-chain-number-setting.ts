import { useState } from "react";
import type { ClaudeAccountsSettings } from "../../../../shared/types.js";

type SaveSettings = (
  patch: Partial<ClaudeAccountsSettings>,
  options: {
    onSuccess: (result: { ok: true } | { ok: false; error: string }) => void;
    onError: () => void;
  },
) => void;

interface ChainNumberSettingOptions {
  field: "thresholdPercent" | "hysteresisPercent";
  saved: number;
  parse: (draft: string) => number | null;
  settingsOnce: SaveSettings;
  saving: boolean;
}

/**
 * Hold the draft, saved and error state of one numeric chain setting and save it on request.
 *
 * @remarks The caller owns the mutation and passes the single-flight save in, so the hook imports no
 * query code. The draft clears after an accepted save, so the field shows the stored value again.
 */
export function useChainNumberSetting({
  field,
  saved,
  parse,
  settingsOnce,
  saving,
}: ChainNumberSettingOptions) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const text = draft ?? String(saved);
  const value = parse(text);

  const save = () => {
    if (value === null) return;
    setJustSaved(false);
    settingsOnce(
      { [field]: value },
      {
        onSuccess: (result) => {
          setError(result.ok ? null : result.error);
          if (!result.ok) return;
          setDraft(null);
          setJustSaved(true);
        },
        onError: () => setError("Couldn't save the setting."),
      },
    );
  };

  return {
    draft: text,
    invalid: value === null,
    saving,
    saveErrorText: error,
    savedText: justSaved ? "Saved" : undefined,
    onChange: (next: string) => {
      setDraft(next);
      setJustSaved(false);
    },
    onSave: save,
  };
}
