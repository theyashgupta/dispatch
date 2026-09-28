import { useEffect, useState, type CSSProperties } from "react";
import {
  PROFILE_BRIEF_MAX,
  PROFILE_TEXT_MAX,
} from "../../../shared/profile.js";
import type { UserProfile } from "../../../shared/types.js";
import { getProfile, saveProfile } from "../../lib/api.js";
import { formatHandles, parseHandles } from "../../lib/profile-handles.js";
import { Button } from "../../primitives/Button.js";
import { Field } from "../../primitives/Field.js";
import { focusRing } from "../../primitives/focus-ring.js";
import { Notice } from "../../primitives/Notice.js";
import {
  settingsInputStyle,
  settingsMutedTextStyle,
  settingsTabStyle,
} from "./settings-styles.js";

type ProfileField = "name" | "email" | "handles" | "role" | "brief";

type ProfileDraft = Record<ProfileField, string>;

function toDraft(profile: UserProfile): ProfileDraft {
  return {
    name: profile.name ?? "",
    email: profile.email ?? "",
    handles: formatHandles(profile.handles ?? []),
    role: profile.role ?? "",
    brief: profile.brief ?? "",
  };
}

const EMPTY_DRAFT = toDraft({});

interface AboutYouTab {
  draft: ProfileDraft;
  setField: (key: ProfileField, value: string) => void;
  loaded: boolean;
  saving: boolean;
  saveError: string | null;
  loadError: boolean;
  handleSave: () => Promise<void>;
}

export function useAboutYouTab(onSaved: () => void): AboutYouTab {
  const [draft, setDraft] = useState<ProfileDraft>(EMPTY_DRAFT);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const profile = await getProfile();
        if (!active) return;
        setDraft(toDraft(profile));
        setLoaded(true);
      } catch (err) {
        console.error("getProfile failed", err);
        if (!active) return;
        setLoadError(true);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  function setField(key: ProfileField, value: string) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    if (saving || !loaded) return;
    setSaving(true);
    setSaveError(null);
    try {
      const result = await saveProfile({
        ...draft,
        handles: parseHandles(draft.handles),
      });
      if (result.ok) {
        setDraft(toDraft(result.profile));
        onSaved();
        return;
      }
      setSaveError(result.error);
    } catch (err) {
      console.error("saveProfile failed", err);
      setSaveError("Couldn't save your profile. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return { draft, setField, loaded, saving, saveError, loadError, handleSave };
}

const rowStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-sm)",
};

const briefStyle: CSSProperties = {
  height: "auto",
  minHeight: "120px",
  padding: "var(--space-sm)",
  resize: "vertical",
};

const TEXT_FIELDS: { key: Exclude<ProfileField, "brief">; label: string }[] = [
  { key: "name", label: "Name" },
  { key: "email", label: "Email" },
  { key: "handles", label: "Handles" },
  { key: "role", label: "Role" },
];

interface AboutYouTabSectionProps {
  aboutYouTab: AboutYouTab;
}

export function AboutYouTabSection({ aboutYouTab }: AboutYouTabSectionProps) {
  const { draft, setField, loaded, saving, saveError, loadError, handleSave } =
    aboutYouTab;
  const [focused, setFocused] = useState<ProfileField | null>(null);
  const focusProps = (key: ProfileField) => ({
    onFocus: () => setFocused(key),
    onBlur: () => setFocused(null),
  });

  return (
    <div className="scroll-stable-y" style={settingsTabStyle}>
      {loadError && (
        <span style={settingsMutedTextStyle}>
          Couldn't load your profile. Reopen settings to retry.
        </span>
      )}
      <span style={settingsMutedTextStyle}>
        Used by triage and the Only mine filter. Stored in
        ~/.dispatch/config.json on this machine and never sent to the board
        stream.
      </span>
      {TEXT_FIELDS.map(({ key, label }) => (
        <label key={key} style={rowStyle}>
          <Field>{label}</Field>
          <input
            type={key === "email" ? "email" : "text"}
            value={draft[key]}
            onChange={(e) => setField(key, e.target.value)}
            maxLength={key === "handles" ? undefined : PROFILE_TEXT_MAX}
            disabled={!loaded || saving}
            {...focusProps(key)}
            style={{ ...settingsInputStyle, ...focusRing(focused === key) }}
          />
        </label>
      ))}
      <label style={rowStyle}>
        <Field>Brief</Field>
        <textarea
          value={draft.brief}
          onChange={(e) => setField("brief", e.target.value)}
          maxLength={PROFILE_BRIEF_MAX}
          disabled={!loaded || saving}
          {...focusProps("brief")}
          style={{
            ...settingsInputStyle,
            ...briefStyle,
            ...focusRing(focused === "brief"),
          }}
        />
      </label>
      {saveError && <Notice tone="destructive" label={saveError} />}
      <div>
        <Button
          variant="primary"
          onClick={() => void handleSave()}
          disabled={!loaded || saving}
          loading={saving}
        >
          {saving ? "Saving…" : "Save profile"}
        </Button>
      </div>
    </div>
  );
}
