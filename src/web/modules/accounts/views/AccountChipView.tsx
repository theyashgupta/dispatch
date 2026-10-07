import { AccountChipContainer } from "@/modules/accounts/containers/AccountChipContainer";

interface AccountChipViewProps {
  onOpenSettings: () => void;
}

export function AccountChipView({ onOpenSettings }: AccountChipViewProps) {
  return <AccountChipContainer onOpenSettings={onOpenSettings} />;
}
