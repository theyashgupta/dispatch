import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { OrchestratorOption } from "@/modules/detail/domain/orchestrator-field";

interface OrchestratorFieldProps {
  options: OrchestratorOption[];
  value: string | null;
  pending: boolean;
  error: string | null;
  onChange: (orchestratorId: string) => void;
}

export function OrchestratorField({
  options,
  value,
  pending,
  error,
  onChange,
}: OrchestratorFieldProps) {
  return (
    <div className="flex flex-col gap-(--space-xs)">
      <span className="text-sm leading-(--line-label) font-medium text-muted-foreground">
        Orchestrator
      </span>
      <Select value={value ?? ""} disabled={pending} onValueChange={onChange}>
        <SelectTrigger
          size="sm"
          variant="surface"
          aria-label="Assign to orchestrator"
          className="max-w-full min-w-0 self-start px-(--space-sm)"
        >
          <SelectValue placeholder="No orchestrator" />
        </SelectTrigger>
        <SelectContent position="popper">
          {options.map((option) => (
            <SelectItem key={option.id} value={option.id}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error != null && (
        <div role="alert" className="text-sm text-destructive-text">
          {error}
        </div>
      )}
    </div>
  );
}
