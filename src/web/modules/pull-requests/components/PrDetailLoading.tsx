import { Skeleton } from "@/components/ui/skeleton";

export function PrDetailLoading() {
  return (
    <div aria-busy="true" className="flex flex-col gap-4">
      <span className="sr-only">Loading pull request</span>
      <div aria-hidden="true" className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <Skeleton className="size-6 shrink-0 rounded-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
        <div className="flex gap-4 border-b border-border pb-2">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 w-16" />
        </div>
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      </div>
    </div>
  );
}
