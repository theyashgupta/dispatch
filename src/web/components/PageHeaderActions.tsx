import type { ReactNode } from "react";

export function PageHeaderActions({ children }: { children: ReactNode }) {
  return (
    <div className="ml-auto flex shrink-0 items-center gap-2">{children}</div>
  );
}
