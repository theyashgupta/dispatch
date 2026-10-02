import { SettingsPanelLayout } from "@/components/SettingsPanelLayout";
import { ClaudeArgsContainer } from "@/modules/settings/containers/ClaudeArgsContainer";
import { CleanupDelayContainer } from "@/modules/settings/containers/CleanupDelayContainer";
import { RetentionContainer } from "@/modules/settings/containers/RetentionContainer";

interface BoardContainerProps {
  onSaved: () => void;
}

export function BoardContainer({ onSaved }: BoardContainerProps) {
  return (
    <SettingsPanelLayout gap="wide">
      <ClaudeArgsContainer onSaved={onSaved} />
      <CleanupDelayContainer onSaved={onSaved} />
      <RetentionContainer onSaved={onSaved} />
    </SettingsPanelLayout>
  );
}
