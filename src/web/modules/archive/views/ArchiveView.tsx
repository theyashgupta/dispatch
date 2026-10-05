import { PageColumn } from "@/components/PageColumn";
import { ArchiveContainer } from "@/modules/archive/containers/ArchiveContainer";

interface ArchiveViewProps {
  onCountChange: (count: number | undefined) => void;
}

export function ArchiveView({ onCountChange }: ArchiveViewProps) {
  return (
    <PageColumn>
      <ArchiveContainer onCountChange={onCountChange} />
    </PageColumn>
  );
}
