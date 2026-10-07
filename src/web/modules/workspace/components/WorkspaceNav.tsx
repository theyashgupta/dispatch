import type { ReactNode } from "react";

interface WorkspaceNavProps {
  controls: ReactNode;
  empty: boolean;
  children: ReactNode;
}

export function WorkspaceNav({ controls, empty, children }: WorkspaceNavProps) {
  return (
    <nav
      aria-label="Tickets"
      className="flex min-h-0 w-(--orca-nav-width) flex-none flex-col border-r border-border bg-(--surface-column)"
    >
      {controls}
      <div className="scroll-stable-y min-h-0 flex-auto overflow-y-auto">
        {empty ? (
          <div className="p-4 text-center text-sm leading-(--line-body) font-normal text-muted-foreground">
            No tickets.
          </div>
        ) : (
          children
        )}
      </div>
    </nav>
  );
}
