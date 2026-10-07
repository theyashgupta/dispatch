import type { ReactNode } from "react";

interface PageBodyProps {
  children?: ReactNode;
}

export function PageBody({ children }: PageBodyProps) {
  return (
    <div className="scroll-stable-y min-h-0 flex-auto overflow-y-auto">
      <div className="mx-auto flex max-w-180 flex-col gap-(--space-lg) p-(--space-lg)">
        {children}
      </div>
    </div>
  );
}
