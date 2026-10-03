import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";

interface VaultSearchProps {
  value: string;
  onChange: (value: string) => void;
}

export function VaultSearch({ value, onChange }: VaultSearchProps) {
  return (
    <div className="relative">
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        type="search"
        aria-label="Search keys"
        placeholder="Search by name or purpose"
        spellCheck={false}
        className="pl-7"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
