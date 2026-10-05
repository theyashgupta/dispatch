import type { ReactNode } from "react";

interface TicketsPaneProps {
  id: string;
  toolbar: ReactNode;
  listed: boolean;
  children: ReactNode;
}

export function TicketsPane({
  id,
  toolbar,
  listed,
  children,
}: TicketsPaneProps) {
  return (
    <div id={id} className="flex min-h-0 flex-1 flex-col">
      {toolbar}
      <div
        role={listed ? "list" : undefined}
        className="scroll-stable-y min-h-0 flex-1 overflow-y-auto"
      >
        {children}
      </div>
    </div>
  );
}
