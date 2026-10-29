import type { ReactNode } from "react";

export function PrListScroll({ children }: { children: ReactNode }) {
  return (
    <div className="scroll-stable-y min-h-0 flex-1 overflow-y-auto">
      {children}
    </div>
  );
}
