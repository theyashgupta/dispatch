import type { ReactNode } from "react";

interface PageColumnProps {
  children: ReactNode;
}

export function PageColumn({ children }: PageColumnProps) {
  return (
    <div className="scroll-stable-y min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-180 flex-col gap-4 p-4">
        {children}
      </div>
    </div>
  );
}
