import type { Card } from "../../../../shared/types.js";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { ModalFieldLabel } from "./ModalFieldLabel";

interface InheritToggleSectionProps {
  card: Card;
  inherit: boolean;
  onChange: (inherit: boolean) => void;
}

export function InheritToggleSection({
  card,
  inherit,
  onChange,
}: InheritToggleSectionProps) {
  const parentOrdinal =
    card.sessionSummaries?.find((s) => s.id === card.activeSessionId)
      ?.ordinal ?? 1;
  return (
    <Field className="flex-none gap-1">
      <ModalFieldLabel>Starting point</ModalFieldLabel>
      <Label className="cursor-pointer items-start gap-2 leading-normal font-normal">
        <Checkbox
          checked={inherit}
          onCheckedChange={(checked) => onChange(checked === true)}
          className="mt-0.5 cursor-pointer"
        />
        <span className="flex flex-col">
          <span className="text-base leading-(--line-body) text-foreground">
            {`Build on Session ${parentOrdinal}`}
          </span>
          <span className="text-sm leading-(--line-label) text-muted-foreground">
            {`Includes Session ${parentOrdinal}'s commits. Any uncommitted work in Session ${parentOrdinal} stays exactly where it is. This new session just starts without it.`}
          </span>
        </span>
      </Label>
    </Field>
  );
}
