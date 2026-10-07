import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { RepositoryValues } from "@/modules/boards/domain/board-form";

interface BoardRepositoryRowProps {
  index: number;
  values: RepositoryValues;
  pathOnly: boolean;
  onChange: (patch: Partial<RepositoryValues>) => void;
  onRemove: () => void;
}

export function BoardRepositoryRow({
  index,
  values,
  pathOnly,
  onChange,
  onRemove,
}: BoardRepositoryRowProps) {
  const id = `board-repo-${index}`;
  return (
    <div className="flex flex-col gap-3 rounded-md border border-border bg-card p-3 sm:flex-row sm:items-end">
      <Field className="min-w-0 flex-2">
        <Label htmlFor={`${id}-path`}>Repository path</Label>
        <Input
          id={`${id}-path`}
          className="font-mono"
          value={values.path}
          onChange={(event) => onChange({ path: event.target.value })}
        />
      </Field>
      {!pathOnly && (
        <>
          <Field className="min-w-0 flex-1">
            <Label htmlFor={`${id}-branch`}>Base branch</Label>
            <Input
              id={`${id}-branch`}
              className="font-mono"
              value={values.baseBranch}
              onChange={(event) => onChange({ baseBranch: event.target.value })}
            />
          </Field>
          <Field className="min-w-0 flex-1 sm:min-w-36">
            <Label htmlFor={`${id}-check`}>Check command</Label>
            <Input
              id={`${id}-check`}
              className="font-mono"
              placeholder="npm run check"
              value={values.checkCommand}
              onChange={(event) =>
                onChange({ checkCommand: event.target.value })
              }
            />
          </Field>
        </>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label={`Remove repository ${index + 1}`}
        onClick={onRemove}
      >
        Remove
      </Button>
    </div>
  );
}
