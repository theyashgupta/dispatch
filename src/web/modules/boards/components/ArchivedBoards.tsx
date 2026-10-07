import type { Board, BoardKey } from "../../../../shared/types.js";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";

interface ArchivedBoardsProps {
  boards: Board[];
  restoringKeys: ReadonlySet<BoardKey>;
  onRestore: (board: Board) => void;
}

export function ArchivedBoards({
  boards,
  restoringKeys,
  onRestore,
}: ArchivedBoardsProps) {
  return (
    <CollapsibleSection title={`Archived boards (${boards.length})`}>
      {boards.length > 0 && (
        <div className="rounded-md border border-border bg-card">
          <Table>
            <TableBody>
              {boards.map((board) => (
                <TableRow key={board.key}>
                  <TableCell>{board.name}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {board.key}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={restoringKeys.has(board.key)}
                      onClick={() => onRestore(board)}
                    >
                      Restore
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </CollapsibleSection>
  );
}
