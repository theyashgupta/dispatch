import type { ReactNode } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Field, FieldDescription, FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadError } from "@/modules/settings/components/LoadError";
import { LoadingButton } from "@/components/LoadingButton";

interface NumberSettingSectionProps {
  id: string;
  label: string;
  ariaLabel: string;
  max: number;
  hint: string;
  value: string;
  invalidText: ReactNode;
  invalid: boolean;
  loadErrorText: string;
  loadError: boolean;
  saveErrorText: string | null;
  saveLabel: string;
  saving: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
}

export function NumberSettingSection({
  id,
  label,
  ariaLabel,
  max,
  hint,
  value,
  invalidText,
  invalid,
  loadErrorText,
  loadError,
  saveErrorText,
  saveLabel,
  saving,
  onChange,
  onSave,
}: NumberSettingSectionProps) {
  return (
    <section className="flex flex-col gap-4">
      {loadError && <LoadError text={loadErrorText} />}
      <Field className="gap-2">
        <Label
          htmlFor={id}
          className="text-sm font-semibold text-muted-foreground"
        >
          {label}
        </Label>
        <div>
          <Input
            id={id}
            type="number"
            min={0}
            max={max}
            step={1}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            aria-label={ariaLabel}
            className="h-8 w-24 text-base md:text-base"
          />
        </div>
        <FieldDescription>{hint}</FieldDescription>
        {invalid && (
          <FieldError className="text-sm font-semibold">
            {invalidText}
          </FieldError>
        )}
        {saveErrorText && (
          <Alert variant="destructive">
            <AlertDescription className="font-semibold">
              {saveErrorText}
            </AlertDescription>
          </Alert>
        )}
      </Field>
      <div>
        <LoadingButton disabled={invalid} loading={saving} onClick={onSave}>
          {saving ? "Saving…" : saveLabel}
        </LoadingButton>
      </div>
    </section>
  );
}
