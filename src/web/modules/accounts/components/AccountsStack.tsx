import type { ReactNode } from "react";

interface AccountsStackProps {
  children: ReactNode;
}

export function AccountsStack({ children }: AccountsStackProps) {
  return <div className="flex flex-col gap-6">{children}</div>;
}
