import { Field, FieldDescription, FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BoardSettingsSection } from "./BoardSettingsSection";

interface BoardTeamKeysSectionProps {
  value: string;
  error?: string;
  canSave: boolean;
  saving: boolean;
  onChange: (value: string) => void;
  onSave?: () => void;
}

export function BoardTeamKeysSection({
  value,
  error,
  canSave,
  saving,
  onChange,
  onSave,
}: BoardTeamKeysSectionProps) {
  return (
    <BoardSettingsSection
      id="board-settings-teams"
      title="Linear team keys"
      description="New Linear issues of these teams go to this board."
      canSave={canSave}
      saving={saving}
      onSave={onSave}
    >
      <Field>
        <Label htmlFor="board-settings-teams-input">Team keys</Label>
        <Input
          id="board-settings-teams-input"
          className="font-mono"
          value={value}
          aria-invalid={error !== undefined}
          aria-describedby="board-settings-teams-help board-settings-teams-error"
          onChange={(event) => onChange(event.target.value)}
        />
        <FieldDescription id="board-settings-teams-help">
          Separate keys with a comma.
        </FieldDescription>
        <FieldError id="board-settings-teams-error">{error}</FieldError>
      </Field>
    </BoardSettingsSection>
  );
}
