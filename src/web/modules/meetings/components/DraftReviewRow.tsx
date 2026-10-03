import { useId } from "react";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { Markdown } from "@/components/markdown/Markdown";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  TITLE_MAX,
  type ReviewRow,
} from "@/modules/meetings/domain/draft-rows";

interface DraftReviewRowProps {
  row: ReviewRow;
  disabled: boolean;
  onChange: (next: ReviewRow) => void;
}

export function DraftReviewRow({
  row,
  disabled,
  onChange,
}: DraftReviewRowProps) {
  const checkId = useId();
  return (
    <li className="grid grid-cols-[1.25rem_minmax(0,1fr)] items-center gap-x-2 gap-y-1 border-b border-border pb-2">
      <Checkbox
        id={checkId}
        checked={row.checked}
        disabled={disabled}
        onCheckedChange={(checked) =>
          onChange({ ...row, checked: checked === true })
        }
      />
      <Label htmlFor={checkId} className="sr-only">
        {row.title === "" ? row.draft.title : row.title}
      </Label>
      <Input
        value={row.title}
        maxLength={TITLE_MAX}
        disabled={disabled}
        aria-label="Title"
        className="h-8 md:text-base"
        onChange={(event) => onChange({ ...row, title: event.target.value })}
      />
      <div className="col-start-2 min-w-0">
        <CollapsibleSection title="Details">
          <Markdown source={row.draft.description} />
        </CollapsibleSection>
      </div>
    </li>
  );
}
