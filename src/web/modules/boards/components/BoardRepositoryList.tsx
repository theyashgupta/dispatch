import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";
import type { RepositoryValues } from "@/modules/boards/domain/board-form";
import { BoardRepositoryRow } from "./BoardRepositoryRow";

interface BoardRepositoryListProps {
  repositories: RepositoryValues[];
  pathOnly?: boolean;
  rowErrors?: Record<number, string>;
  error?: string;
  onChange: (index: number, patch: Partial<RepositoryValues>) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
  onBrowse: (index: number) => void;
}

export function BoardRepositoryList({
  repositories,
  pathOnly,
  rowErrors,
  error,
  onChange,
  onAdd,
  onRemove,
  onBrowse,
}: BoardRepositoryListProps) {
  return (
    <>
      {repositories.map((repository, index) => (
        <BoardRepositoryRow
          key={index}
          index={index}
          values={repository}
          pathOnly={pathOnly}
          error={rowErrors?.[index]}
          onBrowse={() => onBrowse(index)}
          onChange={(patch) => onChange(index, patch)}
          onRemove={() => onRemove(index)}
        />
      ))}
      <FieldError>{error}</FieldError>
      <div>
        <Button type="button" variant="outline" size="sm" onClick={onAdd}>
          Add repository
        </Button>
      </div>
    </>
  );
}
