import { cn } from "@/lib/utils";

interface BoardLayoutProps {
  search?: React.ReactNode;
  pills: React.ReactNode;
  rowRef: React.Ref<HTMLDivElement>;
  isCarousel: boolean;
  isLarge: boolean;
  dragging: boolean;
  children: React.ReactNode;
}

export function BoardLayout({
  search,
  pills,
  rowRef,
  isCarousel,
  isLarge,
  dragging,
  children,
}: BoardLayoutProps) {
  return (
    <div id="board-page" className="flex min-h-0 flex-auto flex-col">
      {search != null && (
        <div className="flex flex-none items-center border-b border-border bg-background px-(--space-lg) py-(--space-sm)">
          {search}
        </div>
      )}
      {pills}
      <div
        ref={rowRef}
        className={cn(
          "flex min-h-0 flex-auto scroll-px-(--space-lg) overflow-x-auto overflow-y-hidden",
          isLarge
            ? "justify-center-safe gap-(--board-gutter-lg) p-(--board-gutter-lg)"
            : "justify-start gap-(--space-lg) p-(--space-lg)",
          isCarousel && !dragging ? "snap-x snap-mandatory" : "snap-none",
        )}
      >
        {children}
      </div>
    </div>
  );
}
