import {
  THEME_PREFERENCES,
  type ThemePreference,
} from "../../../../shared/theme.js";
import { Field, FieldDescription } from "@/components/ui/field";
import { Toggle } from "@/components/ui/toggle";
import { Caption } from "@/modules/settings/components/Caption";

const THEME_LABELS: Record<ThemePreference, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

interface ThemeSectionProps {
  preference: ThemePreference;
  onPreferenceChange: (preference: ThemePreference) => void;
}

export function ThemeSection({
  preference,
  onPreferenceChange,
}: ThemeSectionProps) {
  return (
    <Field className="gap-2">
      <Caption>Theme</Caption>
      <div role="group" aria-label="Theme" className="flex flex-wrap gap-1">
        {THEME_PREFERENCES.map((value) => (
          <Toggle
            key={value}
            variant="outline"
            pressed={preference === value}
            onPressedChange={() => onPreferenceChange(value)}
          >
            {THEME_LABELS[value]}
          </Toggle>
        ))}
      </div>
      <FieldDescription>System follows your operating system.</FieldDescription>
    </Field>
  );
}
