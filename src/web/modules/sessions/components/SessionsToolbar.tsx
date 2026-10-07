import {
  SESSION_SECTIONS,
  type SessionFilter,
} from "../../../../shared/sessions.js";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Toggle } from "@/components/ui/toggle";

interface SessionsToolbarProps {
  filter: SessionFilter;
  accounts: string[];
  onChange: (filter: SessionFilter) => void;
}

const ALL = "__all__";

export function SessionsToolbar({
  filter,
  accounts,
  onChange,
}: SessionsToolbarProps) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-(--surface-column) px-4 py-2">
      <Input
        type="text"
        variant="surface"
        value={filter.query}
        onChange={(event) => onChange({ ...filter, query: event.target.value })}
        placeholder="Search sessions…"
        aria-label="Search sessions"
        className="h-8 w-55 max-w-full flex-none text-base md:text-base"
      />
      <Toggle
        variant="outline"
        size="sm"
        className="px-3"
        pressed={filter.liveOnly}
        onPressedChange={(liveOnly) => onChange({ ...filter, liveOnly })}
      >
        Live only
      </Toggle>
      <Select
        value={filter.account === "" ? ALL : filter.account}
        onValueChange={(value) =>
          onChange({ ...filter, account: value === ALL ? "" : value })
        }
      >
        <SelectTrigger size="sm" variant="surface" aria-label="Account">
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper">
          <SelectItem value={ALL}>All accounts</SelectItem>
          {accounts.map((account) => (
            <SelectItem key={account} value={account}>
              {account}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={filter.status === "" ? ALL : filter.status}
        onValueChange={(value) =>
          onChange({
            ...filter,
            status: SESSION_SECTIONS.find((section) => section === value) ?? "",
          })
        }
      >
        <SelectTrigger size="sm" variant="surface" aria-label="Status">
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper">
          <SelectItem value={ALL}>All statuses</SelectItem>
          {SESSION_SECTIONS.map((section) => (
            <SelectItem key={section} value={section}>
              {section}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
