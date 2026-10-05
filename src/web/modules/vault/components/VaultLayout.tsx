import type { ReactNode } from "react";

interface VaultLayoutProps {
  children: ReactNode;
}

export function VaultLayout({ children }: VaultLayoutProps) {
  return <div className="flex flex-col gap-4">{children}</div>;
}
