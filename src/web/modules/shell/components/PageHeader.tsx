import type { ReactNode } from "react";
import { PageHeaderCount } from "@/components/PageHeaderCount";

interface PageHeaderProps {
  title: string;
  count?: number;
  children?: ReactNode;
}

export function PageHeader({ title, count, children }: PageHeaderProps) {
  return (
    <header className="flex h-(--page-header-height) min-w-0 shrink-0 items-center gap-2 border-b border-border bg-(--surface-column) px-4 select-none">
      <h1
        tabIndex={-1}
        className="m-0 min-w-0 truncate font-sans text-lg font-semibold text-foreground outline-none"
      >
        {title}
      </h1>
      {count != null && <PageHeaderCount count={count} />}
      {children}
    </header>
  );
}
