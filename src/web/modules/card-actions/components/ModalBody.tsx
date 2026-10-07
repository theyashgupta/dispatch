import type { ReactNode } from "react";

interface ModalBodyProps {
  children: ReactNode;
}

export function ModalBody({ children }: ModalBodyProps) {
  return (
    <div className="reading-surface flex min-h-0 flex-auto flex-col gap-4">
      {children}
    </div>
  );
}
