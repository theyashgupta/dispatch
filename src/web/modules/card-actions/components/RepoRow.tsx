import { useRef, useState } from "react";
import type { DiscoveredRepo } from "../../../../shared/types.js";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface RepoRowProps {
  repo: DiscoveredRepo;
  checked: boolean;
  base: string;
  onToggle: () => void;
  onBaseChange: (base: string) => void;
}

export function RepoRow({
  repo,
  checked,
  base,
  onToggle,
  onBaseChange,
}: RepoRowProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(base);
  const draftRef = useRef(base);

  function startEdit() {
    setDraft(base);
    draftRef.current = base;
    setEditing(true);
  }

  function commit() {
    onBaseChange(draftRef.current);
    setEditing(false);
  }

  function cancel() {
    draftRef.current = base;
    setDraft(base);
    setEditing(false);
  }

  return (
    <div className="flex items-center gap-2">
      <Label className="min-w-0 flex-auto cursor-pointer gap-2 text-base leading-(--line-body) font-normal">
        <Checkbox
          checked={checked}
          onCheckedChange={onToggle}
          className="cursor-pointer"
        />
        <span className="truncate">{repo.name}</span>
      </Label>
      <div className="ml-auto shrink-0">
        {editing ? (
          <Input
            ref={(el) => {
              if (el && document.activeElement !== el) el.focus();
            }}
            value={draft}
            aria-label={`Edit base branch for ${repo.name}`}
            onChange={(e) => {
              setDraft(e.target.value);
              draftRef.current = e.target.value;
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit();
              } else if (e.key === "Escape") {
                e.preventDefault();
                cancel();
              }
            }}
            onBlur={commit}
            variant="surface"
            className="h-6 w-auto px-2 py-0 font-mono text-sm md:text-sm"
          />
        ) : (
          <Button
            variant="surface"
            size="xs"
            aria-label={`Edit base branch for ${repo.name}`}
            className="font-mono text-sm font-normal text-muted-foreground"
            onClick={startEdit}
          >
            {base}
          </Button>
        )}
      </div>
    </div>
  );
}
