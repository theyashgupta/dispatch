import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface ReplyFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (text: string) => void;
  onSend: () => void;
  disabled: boolean;
  sending: boolean;
  describedBy?: string | null;
  children?: ReactNode;
}

export function ReplyField({
  id,
  label,
  value,
  onChange,
  onSend,
  disabled,
  sending,
  describedBy = null,
  children,
}: ReplyFieldProps) {
  return (
    <>
      <Field>
        <Label htmlFor={id} className="sr-only">
          {label}
        </Label>
        <Textarea
          id={id}
          value={value}
          placeholder={label}
          onChange={(event) => onChange(event.target.value)}
        />
        <FieldDescription>
          {value.length} of 500 characters. A longer reply goes as a file.
        </FieldDescription>
      </Field>
      <div className="flex flex-wrap items-center gap-(--space-sm)">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || sending || value.trim() === ""}
          aria-describedby={describedBy ?? undefined}
          onClick={onSend}
        >
          Send reply
        </Button>
        {children}
      </div>
    </>
  );
}
