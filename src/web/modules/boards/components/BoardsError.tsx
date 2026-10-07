import { ErrorAlert } from "@/components/ErrorAlert";
import { Button } from "@/components/ui/button";
import { failureText } from "@/modules/boards/domain/board-form";

interface BoardsErrorProps {
  message: string;
  onRetry: () => void;
}

export function BoardsError({ message, onRetry }: BoardsErrorProps) {
  return (
    <ErrorAlert>
      {failureText("Boards did not load", message)}
      <Button type="button" variant="secondary" size="sm" onClick={onRetry}>
        Try again
      </Button>
    </ErrorAlert>
  );
}
