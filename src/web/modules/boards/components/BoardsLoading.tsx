import { Item, ItemContent, ItemGroup } from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";

const PLACEHOLDERS = [0, 1, 2];

export function BoardsLoading() {
  return (
    <>
      <span role="status" className="sr-only">
        Loading boards
      </span>
      <div
        aria-hidden="true"
        className="hidden rounded-md border border-border bg-card md:block"
      >
        <Table>
          <TableBody>
            {PLACEHOLDERS.map((n) => (
              <TableRow key={n}>
                <TableCell>
                  <Skeleton className="h-4 w-full" />
                </TableCell>
                <TableCell className="w-48">
                  <Skeleton className="h-4 w-full" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ItemGroup
        aria-hidden="true"
        className="rounded-md border border-border bg-card md:hidden"
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
    </>
  );
}
