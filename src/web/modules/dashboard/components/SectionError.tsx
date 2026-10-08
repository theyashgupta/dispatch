import { ErrorAlert } from "@/components/ErrorAlert";
import { Button } from "@/components/ui/button";

interface SectionErrorProps {
  title: string;
  message: string;
  onRetry: () => void;
}

export function SectionError({ title, message, onRetry }: SectionErrorProps) {
  return (
    <ErrorAlert>
      {title} did not load: {message}.
      <Button type="button" variant="secondary" size="sm" onClick={onRetry}>
        Try again
      </Button>
    </ErrorAlert>
  );
}
