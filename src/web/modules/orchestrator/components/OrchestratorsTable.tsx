import { Fragment } from "react";
import { Ellipsis } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { OrchestratorRow } from "@/modules/orchestrator/domain/ownership";

export const ADD_EXTRA_REASON = "Start the main orchestrator first.";

interface OrchestratorsTableProps {
  rows: readonly OrchestratorRow[];
  loading: boolean;
  canAdd: boolean;
  canMove: (id: string) => boolean;
  onAdd: () => void;
  onMove: (id: string) => void;
  onEdit: (id: string) => void;
}

export function OrchestratorsTable({
  rows,
  loading,
  canAdd,
  canMove,
  onAdd,
  onMove,
  onEdit,
}: OrchestratorsTableProps) {
  if (loading) return <Skeleton className="h-16 w-full" />;
  return (
    <div className="flex flex-col gap-(--space-md)">
      {rows.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyDescription>No orchestrators yet.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Table aria-label="Orchestrators" className="[&_td]:px-1 [&_th]:px-1">
          <TableHeader>
            <TableRow>
              <TableHead>Orchestrator</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Scope</TableHead>
              <TableHead>Owns</TableHead>
              <TableHead>Policy</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="whitespace-normal">
                  <div className="flex items-start justify-between gap-(--space-xs)">
                    <span>{row.name}</span>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          aria-label={`Actions for ${row.name}`}
                        >
                          <Ellipsis aria-hidden="true" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          disabled={!canMove(row.id)}
                          onSelect={() => onMove(row.id)}
                        >
                          Move groups
                        </DropdownMenuItem>
                        {row.role === "Extra" && (
                          <DropdownMenuItem onSelect={() => onEdit(row.id)}>
                            Edit overrides
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge tone="neutral">{row.role}</Badge>
                </TableCell>
                <TableCell className="whitespace-normal">
                  {row.role === "Main" ? (
                    row.scope
                  ) : (
                    <IdList text={row.scope} />
                  )}
                </TableCell>
                <TableCell className="whitespace-normal">
                  <IdList text={row.owns} />
                </TableCell>
                <TableCell className="whitespace-normal">
                  {row.policy}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <div className="flex flex-col items-start gap-(--space-xs)">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!canAdd}
          aria-describedby={canAdd ? undefined : "add-extra-reason"}
          onClick={onAdd}
        >
          Add extra orchestrator
        </Button>
        {!canAdd && (
          <p
            id="add-extra-reason"
            className="m-0 text-sm text-muted-foreground"
          >
            {ADD_EXTRA_REASON}
          </p>
        )}
      </div>
    </div>
  );
}

function IdList({ text }: { text: string }) {
  const ids = text.split(", ");
  return ids.map((id, i) => (
    <Fragment key={id}>
      {i > 0 && " "}
      <span className="whitespace-nowrap">
        {i < ids.length - 1 ? `${id},` : id}
      </span>
    </Fragment>
  ));
}
