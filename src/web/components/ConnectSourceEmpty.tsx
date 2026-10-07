import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";

interface ConnectSourceEmptyProps {
  testId: string;
  description: string;
  onOpenSettings: () => void;
}

export function ConnectSourceEmpty({
  testId,
  description,
  onOpenSettings,
}: ConnectSourceEmptyProps) {
  return (
    <Empty className="py-12" data-testid={testId}>
      <EmptyHeader>
        <EmptyTitle className="text-sm font-semibold text-muted-foreground">
          Connect a source
        </EmptyTitle>
        <EmptyDescription className="text-base text-foreground">
          {description}
        </EmptyDescription>
      </EmptyHeader>
      <Button type="button" onClick={onOpenSettings}>
        Open Settings
      </Button>
    </Empty>
  );
}
