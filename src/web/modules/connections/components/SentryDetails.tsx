import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

interface SentryDetailsProps {
  errorsInFeeds: boolean;
  onToggleErrorsInFeeds: (on: boolean) => void;
}

export function SentryDetails({
  errorsInFeeds,
  onToggleErrorsInFeeds,
}: SentryDetailsProps) {
  return (
    <div className="flex flex-col gap-1">
      <Label className="cursor-pointer gap-2 text-base font-normal">
        <Checkbox
          checked={errorsInFeeds}
          onCheckedChange={() => onToggleErrorsInFeeds(!errorsInFeeds)}
        />
        Show errors in Today and Inbox
      </Label>
      <span className="text-sm text-muted-foreground">
        Errors always show on the Errors page.
      </span>
    </div>
  );
}
