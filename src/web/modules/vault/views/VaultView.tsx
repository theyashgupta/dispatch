import { PageColumn } from "@/components/PageColumn";
import { VaultContainer } from "@/modules/vault/containers/VaultContainer";

interface VaultViewProps {
  onCountChange: (count: number | undefined) => void;
}

export function VaultView({ onCountChange }: VaultViewProps) {
  return (
    <PageColumn>
      <VaultContainer onCountChange={onCountChange} />
    </PageColumn>
  );
}
