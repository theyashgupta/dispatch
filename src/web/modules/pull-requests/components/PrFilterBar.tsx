import type { PrFilters } from "../../../../shared/pr-rows.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Toggle } from "@/components/ui/toggle";

interface PrFilterBarProps {
  filters: PrFilters;
  authors: string[];
  repos: string[];
  onChange: (filters: PrFilters) => void;
}

const ALL = "__all__";

export function PrFilterBar({
  filters,
  authors,
  repos,
  onChange,
}: PrFilterBarProps) {
  return (
    <div className="flex flex-none flex-wrap items-center gap-2 border-b border-border bg-sidebar px-4 py-2">
      <Toggle
        variant="outline"
        size="sm"
        className="px-3"
        pressed={filters.mine}
        onPressedChange={(mine) => onChange({ ...filters, mine })}
      >
        Mine
      </Toggle>
      <Toggle
        variant="outline"
        size="sm"
        className="px-3"
        pressed={filters.reviewRequested}
        onPressedChange={(reviewRequested) =>
          onChange({ ...filters, reviewRequested })
        }
      >
        Review requested
      </Toggle>
      <Select
        value={filters.author === "" ? ALL : filters.author}
        onValueChange={(value) =>
          onChange({ ...filters, author: value === ALL ? "" : value })
        }
      >
        <SelectTrigger
          size="sm"
          aria-label="Author"
          className="max-w-full flex-none"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent
          position="popper"
          className="max-w-(--radix-select-content-available-width)"
        >
          <SelectItem value={ALL}>All authors</SelectItem>
          {authors.map((author) => (
            <SelectItem key={author} value={author} className="break-all">
              {author}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={filters.repo === "" ? ALL : filters.repo}
        onValueChange={(value) =>
          onChange({ ...filters, repo: value === ALL ? "" : value })
        }
      >
        <SelectTrigger
          size="sm"
          aria-label="Repository"
          className="max-w-full flex-none"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent
          position="popper"
          className="max-w-(--radix-select-content-available-width)"
        >
          <SelectItem value={ALL}>All repositories</SelectItem>
          {repos.map((repo) => (
            <SelectItem key={repo} value={repo} className="break-all">
              {repo}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
