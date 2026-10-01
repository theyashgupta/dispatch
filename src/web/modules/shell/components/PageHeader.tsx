import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  count?: number;
  actions?: ReactNode;
}

export function PageHeader({ title, count, actions }: PageHeaderProps) {
  return (
    <header className="flex h-(--page-header-height) min-w-0 shrink-0 items-center gap-2 border-b border-border bg-(--surface-column) px-4 select-none">
      <h1
        tabIndex={-1}
        className="m-0 font-sans text-lg font-semibold whitespace-nowrap text-foreground outline-none"
      >
        {title}
      </h1>
      {count != null && (
        <span className="text-sm font-medium text-muted-foreground">
          {count}
        </span>
      )}
      {actions != null && (
        <div className="ml-auto flex min-w-0 items-center gap-2">{actions}</div>
      )}
    </header>
  );
}
