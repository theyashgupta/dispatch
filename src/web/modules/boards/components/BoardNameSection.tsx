import { Field, FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BoardSettingsSection } from "./BoardSettingsSection";

interface BoardNameSectionProps {
  name: string;
  error?: string;
  canSave: boolean;
  saving: boolean;
  onChange: (name: string) => void;
  onSave: () => void;
}

export function BoardNameSection({
  name,
  error,
  canSave,
  saving,
  onChange,
  onSave,
}: BoardNameSectionProps) {
  return (
    <BoardSettingsSection
      id="board-settings-name"
      title="Name"
      description="The name the board list and the board switcher show."
      canSave={canSave}
      saving={saving}
      onSave={onSave}
    >
      <Field>
        <Label htmlFor="board-settings-name-input">Board name</Label>
        <Input
          id="board-settings-name-input"
          value={name}
          aria-invalid={error !== undefined}
          aria-describedby="board-settings-name-error"
          onChange={(event) => onChange(event.target.value)}
        />
        <FieldError id="board-settings-name-error">{error}</FieldError>
      </Field>
    </BoardSettingsSection>
  );
}
