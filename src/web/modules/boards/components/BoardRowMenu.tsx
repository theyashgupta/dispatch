import { Ellipsis } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ArchiveAction } from "@/modules/boards/domain/board-archive";

interface BoardRowMenuProps {
  archive: ArchiveAction;
  onOpen: () => void;
  onEdit: () => void;
  onArchive: () => void;
}

export function BoardRowMenu({
  archive,
  onOpen,
  onEdit,
  onArchive,
}: BoardRowMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-xs" aria-label="Board actions">
          <Ellipsis aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onOpen}>Open board</DropdownMenuItem>
        <DropdownMenuItem onSelect={onEdit}>Edit</DropdownMenuItem>
        {archive.kind !== "none" && (
          <DropdownMenuItem
            disabled={archive.kind === "disabled"}
            onSelect={onArchive}
          >
            Archive
          </DropdownMenuItem>
        )}
        {archive.kind === "disabled" && (
          <DropdownMenuLabel className="pt-0 text-xs font-normal text-muted-foreground">
            {archive.reason}
          </DropdownMenuLabel>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
