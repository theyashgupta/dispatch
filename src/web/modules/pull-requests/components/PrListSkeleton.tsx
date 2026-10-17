import { Skeleton } from "@/components/ui/skeleton";

const ROWS = [0, 1, 2, 3, 4];

export function PrListSkeleton() {
  return (
    <div aria-busy="true" data-testid="pr-list-skeleton">
      <span className="sr-only">Loading pull requests</span>
      {ROWS.map((n) => (
        <div
          key={n}
          aria-hidden="true"
          className="flex items-start gap-2 border-b border-border px-4 py-2"
        >
          <Skeleton className="size-6 shrink-0 rounded-full" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/2" />
            <div className="flex gap-1">
              <Skeleton className="h-4 w-12" />
              <Skeleton className="h-4 w-12" />
              <Skeleton className="h-4 w-12" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
