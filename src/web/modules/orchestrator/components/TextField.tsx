import { Field, FieldDescription, FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface TextFieldProps {
  id: string;
  label: string;
  value: string;
  placeholder?: string;
  description?: string;
  error?: string | undefined;
  onChange: (value: string) => void;
}

export function TextField({
  id,
  label,
  value,
  placeholder,
  description,
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
        aria-describedby={
          [
            description === undefined ? null : `${id}-description`,
            error === undefined ? null : `${id}-error`,
          ]
            .filter(Boolean)
            .join(" ") || undefined
        }
        onChange={(event) => onChange(event.target.value)}
      />
      {description !== undefined && (
        <FieldDescription id={`${id}-description`}>
          {description}
        </FieldDescription>
      )}
      <FieldError id={`${id}-error`}>{error}</FieldError>
    </Field>
  );
}
