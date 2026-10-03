import {
  PROFILE_BRIEF_MAX,
  PROFILE_TEXT_MAX,
} from "../../../../shared/profile.js";
import { ErrorAlert } from "@/components/ErrorAlert";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { LoadError } from "@/modules/settings/components/LoadError";
import { LoadingButton } from "@/components/LoadingButton";
import type {
  ProfileDraft,
  ProfileField,
} from "@/modules/settings/domain/profile-draft";

const TEXT_FIELDS: { key: Exclude<ProfileField, "brief">; label: string }[] = [
  { key: "name", label: "Name" },
  { key: "email", label: "Email" },
  { key: "handles", label: "Handles" },
  { key: "role", label: "Role" },
];

interface AboutYouSectionProps {
  draft: ProfileDraft;
  loaded: boolean;
  saving: boolean;
  saveError: string | null;
  loadError: boolean;
  onFieldChange: (key: ProfileField, value: string) => void;
  onSave: () => void;
}

export function AboutYouSection({
  draft,
  loaded,
  saving,
  saveError,
  loadError,
  onFieldChange,
  onSave,
}: AboutYouSectionProps) {
  const disabled = !loaded || saving;
  return (
    <>
      {loadError && (
        <LoadError text="Couldn't load your profile. Reopen settings to retry." />
      )}
      <span className="text-sm text-muted-foreground">
        Used by triage and the Only mine filter. Stored in
        ~/.dispatch/config.json on this machine and never sent to the board
        stream.
      </span>
      {TEXT_FIELDS.map(({ key, label }) => (
        <Field key={key} className="gap-2">
          <Label
            htmlFor={`profile-${key}`}
            className="text-sm font-semibold text-muted-foreground"
          >
            {label}
          </Label>
          <Input
            id={`profile-${key}`}
            type={key === "email" ? "email" : "text"}
            value={draft[key]}
            onChange={(e) => onFieldChange(key, e.target.value)}
            maxLength={key === "handles" ? undefined : PROFILE_TEXT_MAX}
            disabled={disabled}
            className="h-8 text-base md:text-base"
          />
        </Field>
      ))}
      <Field className="gap-2">
        <Label
          htmlFor="profile-brief"
          className="text-sm font-semibold text-muted-foreground"
        >
          Brief
        </Label>
        <Textarea
          id="profile-brief"
          value={draft.brief}
          onChange={(e) => onFieldChange("brief", e.target.value)}
          maxLength={PROFILE_BRIEF_MAX}
          disabled={disabled}
          className="field-sizing-fixed min-h-30 resize-y text-base md:text-base"
        />
      </Field>
      {saveError && <ErrorAlert>{saveError}</ErrorAlert>}
      <div>
        <LoadingButton disabled={disabled} loading={saving} onClick={onSave}>
          {saving ? "Saving…" : "Save profile"}
        </LoadingButton>
      </div>
    </>
  );
}
