import { ErrorAlert } from "@/components/ErrorAlert";
import { Button } from "@/components/ui/button";
import { failureText } from "@/modules/boards/domain/board-form";

interface BoardsErrorProps {
  title: string;
  message: string;
  onRetry: () => void;
}

export function BoardsError({ title, message, onRetry }: BoardsErrorProps) {
  return (
    <ErrorAlert>
      {failureText(title, message)}
      <Button type="button" variant="secondary" size="sm" onClick={onRetry}>
        Try again
      </Button>
    </ErrorAlert>
  );
}
