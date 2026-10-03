import type { ReactNode } from "react";

interface VaultKeyListProps {
  children: ReactNode;
}

export function VaultKeyList({ children }: VaultKeyListProps) {
  return <div className="flex flex-col gap-2">{children}</div>;
}
