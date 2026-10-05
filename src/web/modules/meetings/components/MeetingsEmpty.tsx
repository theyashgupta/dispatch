import { Button } from "@/components/ui/button";

interface MeetingsEmptyProps {
  onOpenMeetingNotes: () => void;
}

export function MeetingsEmpty({ onOpenMeetingNotes }: MeetingsEmptyProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-base text-muted-foreground">
      <span>
        No meeting action items yet. Paste meeting notes, or turn on Granola in
        Settings.
      </span>
      <Button onClick={onOpenMeetingNotes}>From meeting notes</Button>
    </div>
  );
}
