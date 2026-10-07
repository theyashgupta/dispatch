import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface GroupByToolbarProps<T extends string> {
  value: T;
  labels: Record<T, string>;
  onChange: (value: T) => void;
}

export function GroupByToolbar<T extends string>({
  value,
  labels,
  onChange,
}: GroupByToolbarProps<T>) {
  return (
    <div className="flex flex-none flex-wrap items-center gap-2 border-b border-border bg-sidebar px-4 py-2">
      <Select value={value} onValueChange={(next) => onChange(next as T)}>
        <SelectTrigger size="sm" aria-label="Group by" className="flex-none">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(labels) as T[]).map((key) => (
            <SelectItem key={key} value={key}>
              {labels[key]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
