import { PageColumn } from "@/components/PageColumn";
import { BoardSettingsContainer } from "@/modules/boards/containers/BoardSettingsContainer";

interface BoardSettingsViewProps {
  boardKey: string;
}

export function BoardSettingsView({ boardKey }: BoardSettingsViewProps) {
  return (
    <PageColumn>
      <BoardSettingsContainer boardKey={boardKey} />
    </PageColumn>
  );
}
