import { Spinner } from "@/components/ui/spinner";

export function PageFallback() {
  return (
    <div
      role="status"
      aria-label="Loading page"
      className="flex flex-auto items-center justify-center"
    >
      <Spinner aria-hidden="true" className="size-3.5" />
    </div>
  );
}
