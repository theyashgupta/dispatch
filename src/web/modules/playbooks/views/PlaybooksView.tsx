import { PageColumn } from "@/components/PageColumn";
import { PlaybooksContainer } from "@/modules/playbooks/containers/PlaybooksContainer";

interface PlaybooksViewProps {
  createRequest: number;
  onCountChange: (count: number | undefined) => void;
}

export function PlaybooksView({
  createRequest,
  onCountChange,
}: PlaybooksViewProps) {
  return (
    <PageColumn>
      <PlaybooksContainer
        createRequest={createRequest}
        onCountChange={onCountChange}
      />
    </PageColumn>
  );
}
