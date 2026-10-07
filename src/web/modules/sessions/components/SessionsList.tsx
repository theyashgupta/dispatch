import type { ReactNode } from "react";
import { GroupCollapsible } from "@/components/GroupCollapsible";
import { Glyph } from "@/components/icons/Glyph";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

export function SessionsScroll({ children }: { children: ReactNode }) {
  return (
    <div className="scroll-stable-y min-h-0 flex-auto overflow-y-auto">
      {children}
    </div>
  );
}

interface SessionsSectionProps {
  label: string;
  count: number;
  children: ReactNode;
}

export function SessionsSection({
  label,
  count,
  children,
}: SessionsSectionProps) {
  return (
    <div className="px-4" data-testid="sessions-section">
      <GroupCollapsible label={label} count={count}>
        <div role="list" className="-mx-4">
          {children}
        </div>
      </GroupCollapsible>
    </div>
  );
}

export function SessionsNoRows() {
  return (
    <Empty className="gap-2 px-4 py-12 text-wrap">
      <EmptyMedia>
        <Glyph size={48} className="opacity-8" />
      </EmptyMedia>
      <EmptyHeader className="max-w-none gap-2">
        <EmptyTitle className="text-base font-semibold">
          No sessions yet
        </EmptyTitle>
        <EmptyDescription>
          Start a ticket from the Board and its session shows up here.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

export function SessionsNoMatch() {
  return (
    <Empty className="gap-2 px-4 py-12 text-wrap">
      <EmptyHeader className="max-w-none gap-2">
        <EmptyTitle className="text-base font-semibold">
          No matching sessions
        </EmptyTitle>
        <EmptyDescription>Try a different filter.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
