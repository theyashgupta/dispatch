import { Item, ItemContent, ItemGroup } from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";

const PLACEHOLDERS = [0, 1, 2];

export function SectionLoading() {
  return (
    <ItemGroup
      aria-hidden="true"
      className="rounded-md border border-border bg-card"
    >
      {PLACEHOLDERS.map((n) => (
        <Item key={n} role="presentation" size="sm">
          <ItemContent>
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-full" />
          </ItemContent>
        </Item>
      ))}
    </ItemGroup>
  );
}
