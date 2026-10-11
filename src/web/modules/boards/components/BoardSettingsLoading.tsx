import { Skeleton } from "@/components/ui/skeleton";

export function BoardSettingsLoading() {
  return (
    <>
      <span role="status" className="sr-only">
        Loading board settings
      </span>
      <Skeleton aria-hidden="true" className="h-8 w-48" />
      <Skeleton aria-hidden="true" className="h-40 w-full" />
      <Skeleton aria-hidden="true" className="h-40 w-full" />
    </>
  );
}
