import type { ComponentProps, ReactNode } from "react";
import { ErrorAlert } from "@/components/ErrorAlert";
import { Field, FieldDescription, FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  loadErrorText?: string;
  saveErrorText: string | null;
  saveLabel: string;
  saving: boolean;
  savedText?: string;
  buttonVariant?: ComponentProps<typeof LoadingButton>["variant"];
  inlineAction?: boolean;
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
  saveErrorText,
  saveLabel,
  saving,
  savedText,
  buttonVariant,
  inlineAction = false,
  onChange,
  onSave,
}: NumberSettingSectionProps) {
  const input = (
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
  );
  const saveButton = (
    <LoadingButton
      variant={buttonVariant}
      disabled={invalid}
      loading={saving}
      onClick={onSave}
    >
      {saving ? "Saving…" : saveLabel}
    </LoadingButton>
  );
  const savedStatus = savedText && (
    <span role="status" className="text-sm text-muted-foreground">
      {savedText}
    </span>
  );
  return (
    <section className="flex flex-col gap-4">
      {loadErrorText && (
        <span className="text-base text-muted-foreground">{loadErrorText}</span>
      )}
      <Field className="gap-2">
        <Label
          htmlFor={id}
          className="text-sm font-semibold text-muted-foreground"
        >
          {label}
        </Label>
        {inlineAction ? (
          <div className="flex items-center gap-2">
            {input}
            {saveButton}
            {savedStatus}
          </div>
        ) : (
          <div>{input}</div>
        )}
        <FieldDescription>{hint}</FieldDescription>
        {invalid && (
          <FieldError className="text-sm font-semibold">
            {invalidText}
          </FieldError>
        )}
        {saveErrorText && <ErrorAlert>{saveErrorText}</ErrorAlert>}
      </Field>
      {!inlineAction && <div>{saveButton}</div>}
    </section>
  );
}
