import { Field, FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface TextFieldProps {
  id: string;
  label: string;
  value: string;
  placeholder?: string;
  error?: string | undefined;
  onChange: (value: string) => void;
}

export function TextField({
  id,
  label,
  value,
  placeholder,
  error,
  onChange,
}: TextFieldProps) {
  return (
    <Field>
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        inputMode="decimal"
        value={value}
        placeholder={placeholder}
        aria-invalid={error !== undefined}
        aria-describedby={error === undefined ? undefined : `${id}-error`}
        onChange={(event) => onChange(event.target.value)}
      />
      <FieldError id={`${id}-error`}>{error}</FieldError>
    </Field>
  );
}
