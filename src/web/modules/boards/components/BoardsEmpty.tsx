import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";

interface BoardsEmptyProps {
  onNewBoard: () => void;
}

export function BoardsEmpty({ onNewBoard }: BoardsEmptyProps) {
  return (
    <Empty className="gap-2 border p-8">
      <EmptyHeader className="max-w-none gap-2">
        <EmptyTitle className="text-base font-semibold">One board</EmptyTitle>
        <EmptyDescription>
          Add a board to keep a second project apart from this one.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button type="button" size="sm" onClick={onNewBoard}>
          New board
        </Button>
      </EmptyContent>
    </Empty>
  );
}
