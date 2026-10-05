import { Plus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { LoadingButton } from "@/components/LoadingButton";

interface VaultAddFormProps {
  name: string;
  purpose: string;
  error: string | null;
  pending: boolean;
  onNameChange: (value: string) => void;
  onPurposeChange: (value: string) => void;
  onAdd: () => void;
}

export function VaultAddForm({
  name,
  purpose,
  error,
  pending,
  onNameChange,
  onPurposeChange,
  onAdd,
}: VaultAddFormProps) {
  return (
    <Card className="gap-0 border-border py-0 shadow-none">
      <CardContent className="flex flex-col gap-2 p-4">
        <div className="flex gap-2">
          <Field className="flex-1 gap-1">
            <FieldLabel htmlFor="vault-new-name">Name</FieldLabel>
            <Input
              id="vault-new-name"
              aria-label="New key name"
              placeholder="API_KEY"
              spellCheck={false}
              className="font-mono"
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
            />
          </Field>
          <Field className="flex-1 gap-1">
            <FieldLabel htmlFor="vault-new-purpose">Purpose</FieldLabel>
            <Input
              id="vault-new-purpose"
              aria-label="New key purpose"
              placeholder="One-line purpose"
              value={purpose}
              onChange={(e) => onPurposeChange(e.target.value)}
            />
          </Field>
        </div>
        {error !== null && (
          <FieldError role="alert" className="text-sm font-semibold">
            {error}
          </FieldError>
        )}
        <div className="flex justify-end">
          <LoadingButton loading={pending} onClick={onAdd}>
            <Plus aria-hidden="true" />
            {pending ? "Adding..." : "Add key"}
          </LoadingButton>
        </div>
      </CardContent>
    </Card>
  );
}
