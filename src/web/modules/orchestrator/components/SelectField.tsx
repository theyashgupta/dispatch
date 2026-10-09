import { Field, FieldDescription } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { SelectOption } from "@/modules/orchestrator/domain/orchestrator-models";

interface SelectFieldProps {
  id: string;
  label: string;
  value: string;
  options: readonly SelectOption[];
  description?: string;
  onChange: (value: string) => void;
}

export function SelectField({
  id,
  label,
  value,
  options,
  description,
  onChange,
}: SelectFieldProps) {
  return (
    <Field>
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="max-w-[calc(100vw-2rem)]">
          {options.map((option) => (
            <SelectItem
              key={option.value}
              value={option.value}
              className="wrap-anywhere"
            >
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {description !== undefined && (
        <FieldDescription>{description}</FieldDescription>
      )}
    </Field>
  );
}
