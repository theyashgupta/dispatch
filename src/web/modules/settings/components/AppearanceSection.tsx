import { FONT_FAMILY } from "../../../../shared/nerd-font-mono.js";
import {
  TERMINAL_FONT_FAMILIES,
  TERMINAL_FONT_SIZE_MAX,
  TERMINAL_FONT_SIZE_MIN,
} from "../../../../shared/terminal-appearance.js";
import type { ThemePreference } from "../../../../shared/theme.js";
import type { TerminalAppearance } from "../../../../shared/types.js";
import { ErrorAlert } from "@/components/ErrorAlert";
import { Field, FieldDescription, FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fontOptionLabel } from "@/modules/settings/domain/terminal-fonts";
import { useInstalledFonts } from "@/modules/settings/hooks/use-installed-fonts";
import { LoadError } from "@/modules/settings/components/LoadError";
import { ThemeSection } from "@/modules/settings/components/ThemeSection";

const FONT_FAMILY_LABELS: Record<string, string> = {
  [FONT_FAMILY]: "JetBrains Mono Nerd Font (bundled)",
  monospace: "System monospace",
};

type TerminalColorKey = "background" | "foreground" | "cursor";

const COLOR_ROWS: { key: TerminalColorKey; label: string }[] = [
  { key: "background", label: "Background color" },
  { key: "foreground", label: "Text color" },
  { key: "cursor", label: "Cursor color" },
];

interface AppearanceSectionProps {
  preference: ThemePreference;
  draft: Omit<TerminalAppearance, "fontSize">;
  draftFontSize: string;
  loadError: boolean;
  validationError: string | null;
  saveError: string | null;
  onPreferenceChange: (preference: ThemePreference) => void;
  onColorChange: (key: TerminalColorKey, value: string) => void;
  onFontFamilyChange: (value: string) => void;
  onFontSizeChange: (value: string) => void;
}

export function AppearanceSection({
  preference,
  draft,
  draftFontSize,
  loadError,
  validationError,
  saveError,
  onPreferenceChange,
  onColorChange,
  onFontFamilyChange,
  onFontSizeChange,
}: AppearanceSectionProps) {
  const installedFonts = useInstalledFonts(TERMINAL_FONT_FAMILIES);
  return (
    <>
      <ThemeSection
        preference={preference}
        onPreferenceChange={onPreferenceChange}
      />
      {loadError && (
        <LoadError text="Couldn't load the terminal appearance. Reopen settings to retry." />
      )}
      {COLOR_ROWS.map(({ key, label }) => (
        <Field key={key} className="gap-2">
          <Label
            htmlFor={`terminal-${key}`}
            className="text-sm font-semibold text-muted-foreground"
          >
            {label}
          </Label>
          <div>
            <Input
              id={`terminal-${key}`}
              type="color"
              value={draft[key]}
              onChange={(e) => onColorChange(key, e.target.value)}
              aria-label={`Terminal ${key} color`}
              className="h-8 w-16 p-0.5"
            />
          </div>
        </Field>
      ))}
      <Field className="gap-2">
        <Label
          htmlFor="terminal-font-family"
          className="text-sm font-semibold text-muted-foreground"
        >
          Font family
        </Label>
        <div>
          <Select value={draft.fontFamily} onValueChange={onFontFamilyChange}>
            <SelectTrigger
              id="terminal-font-family"
              size="sm"
              aria-label="Terminal font family"
              className="w-full max-w-70"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TERMINAL_FONT_FAMILIES.map((name) => (
                <SelectItem key={name} value={name}>
                  {fontOptionLabel(name, installedFonts, FONT_FAMILY_LABELS)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <FieldDescription>
          Fonts marked not installed fall back to the bundled Nerd Font, which
          always stays as the fallback so Claude Code's glyphs keep rendering.
        </FieldDescription>
      </Field>
      <Field className="gap-2">
        <Label
          htmlFor="terminal-font-size"
          className="text-sm font-semibold text-muted-foreground"
        >
          Font size (px)
        </Label>
        <div>
          <Input
            id="terminal-font-size"
            type="number"
            min={TERMINAL_FONT_SIZE_MIN}
            max={TERMINAL_FONT_SIZE_MAX}
            step={1}
            value={draftFontSize}
            onChange={(e) => onFontSizeChange(e.target.value)}
            aria-label="Terminal font size in pixels"
            className="h-8 w-24 max-w-full text-base md:text-base"
          />
        </div>
      </Field>
      {validationError && (
        <FieldError className="text-sm font-semibold">
          {validationError}
        </FieldError>
      )}
      {saveError && <ErrorAlert>{saveError}</ErrorAlert>}
    </>
  );
}
