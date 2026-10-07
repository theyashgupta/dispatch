import type { Board } from "../../../../shared/types.js";
import { DEFAULT_BOARD_KEY } from "../../../../shared/board-key.js";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  repositoryCountLabel,
  repositoryNames,
} from "@/modules/boards/domain/board-counts";
import type { BoardRow } from "@/modules/boards/domain/board-rows";
import { BoardCountBadge } from "./BoardCountBadge";
import { BoardNameMarks } from "./BoardNameMarks";
import { BoardRowMenu } from "./BoardRowMenu";

interface BoardsTableProps {
  rows: BoardRow[];
  onOpen: (board: Board) => void;
  onEdit: (board: Board) => void;
  onArchive: (board: Board) => void;
}

export function BoardsTable({
  rows,
  onOpen,
  onEdit,
  onArchive,
}: BoardsTableProps) {
  return (
    <div className="hidden rounded-md border border-border bg-card md:block">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead scope="col">Name</TableHead>
            <TableHead scope="col">Key</TableHead>
            <TableHead scope="col">Repositories</TableHead>
            <TableHead scope="col">Running</TableHead>
            <TableHead scope="col">Open groups</TableHead>
            <TableHead scope="col">Attention</TableHead>
            <TableHead scope="col">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.board.key}>
              <TableCell>
                <div className="flex items-center gap-2">
                  <span className="max-w-48 truncate" title={row.board.name}>
                    {row.board.name}
                  </span>
                  <BoardNameMarks
                    isDefault={row.board.key === DEFAULT_BOARD_KEY}
                    keyClash={row.keyClash}
                  />
                </div>
              </TableCell>
              <TableCell className="font-mono text-xs">
                {row.board.key}
              </TableCell>
              <TableCell>
                <span
                  className="hidden max-w-40 truncate xl:block"
                  title={repositoryNames(row.board.repositories)}
                >
                  {repositoryNames(row.board.repositories)}
                </span>
                <span className="xl:hidden">
                  {repositoryCountLabel(row.board.repositories.length)}
                </span>
              </TableCell>
              <TableCell>
                <BoardCountBadge
                  kind="running"
                  count={row.counts?.running ?? null}
                />
              </TableCell>
              <TableCell>
                <BoardCountBadge
                  kind="openGroups"
                  count={row.counts?.openGroups ?? null}
                />
              </TableCell>
              <TableCell>
                <BoardCountBadge
                  kind="attention"
                  count={row.counts?.attention ?? null}
                />
              </TableCell>
              <TableCell className="text-right">
                <BoardRowMenu
                  archive={row.archive}
                  onOpen={() => onOpen(row.board)}
                  onEdit={() => onEdit(row.board)}
                  onArchive={() => onArchive(row.board)}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
