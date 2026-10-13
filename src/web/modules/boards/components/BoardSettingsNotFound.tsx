import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";

interface BoardSettingsNotFoundProps {
  href: string;
}

export function BoardSettingsNotFound({ href }: BoardSettingsNotFoundProps) {
  return (
    <Empty className="gap-2 border p-8">
      <EmptyHeader className="max-w-none gap-2">
        <EmptyTitle className="text-base font-semibold">
          Board not found
        </EmptyTitle>
        <EmptyDescription>No board has this key.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button asChild variant="link" size="sm">
          <a href={href}>Back to boards</a>
        </Button>
      </EmptyContent>
    </Empty>
  );
}
