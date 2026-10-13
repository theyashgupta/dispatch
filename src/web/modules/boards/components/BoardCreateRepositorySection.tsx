import { LoadingButton } from "@/components/LoadingButton";
import { FieldError } from "@/components/ui/field";
import { BoardSettingsSection } from "./BoardSettingsSection";

interface BoardCreateRepositorySectionProps {
  running: boolean;
  disabled: boolean;
  error: string | null;
  onCreate: () => void;
}

export function BoardCreateRepositorySection({
  running,
  disabled,
  error,
  onCreate,
}: BoardCreateRepositorySectionProps) {
  return (
    <BoardSettingsSection
      id="board-settings-create"
      title="Create a repository here"
      description="Dispatch makes a new git repository in the board folder and adds it to this board. Nothing leaves this computer."
    >
      <div>
        <LoadingButton
          variant="secondary"
          loading={running}
          disabled={disabled}
          onClick={onCreate}
        >
          Create a repository here
        </LoadingButton>
      </div>
      <FieldError>{error}</FieldError>
    </BoardSettingsSection>
  );
}
