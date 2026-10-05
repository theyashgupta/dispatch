import type { ReactNode } from "react";

interface ModalActionsProps {
  children: ReactNode;
}

export function ModalActions({ children }: ModalActionsProps) {
  return (
    <div className="px-6 pb-6">
      <div className="flex justify-end gap-2 [&_button]:h-auto [&_button]:min-h-8 [&_button]:shrink [&_button]:py-1 [&_button]:whitespace-normal">
        {children}
      </div>
    </div>
  );
}
