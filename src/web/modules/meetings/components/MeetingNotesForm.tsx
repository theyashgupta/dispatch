import type { Ref } from "react";
import { ErrorAlert } from "@/components/ErrorAlert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import {
  ME_MAX,
  MEETING_MAX,
  NOTES_MAX,
} from "@/modules/meetings/domain/draft-rows";

interface MeetingNotesFormProps {
  meeting: string;
  me: string;
  notes: string;
  generating: boolean;
  draftError: string | null;
  meetingRef: Ref<HTMLInputElement>;
  onMeetingChange: (value: string) => void;
  onMeChange: (value: string) => void;
  onNotesChange: (value: string) => void;
}

const FIELD = "flex min-w-0 flex-col gap-1";

export function MeetingNotesForm({
  meeting,
  me,
  notes,
  generating,
  draftError,
  meetingRef,
  onMeetingChange,
  onMeChange,
  onNotesChange,
}: MeetingNotesFormProps) {
  return (
    <>
      <div className={FIELD}>
        <Label htmlFor="meeting-notes-meeting">Meeting name</Label>
        <Input
          id="meeting-notes-meeting"
          ref={meetingRef}
          value={meeting}
          maxLength={MEETING_MAX}
          disabled={generating}
          className="h-8 md:text-base"
          onChange={(event) => onMeetingChange(event.target.value)}
        />
      </div>
      <div className={FIELD}>
        <Label htmlFor="meeting-notes-me">Your name in these notes</Label>
        <Input
          id="meeting-notes-me"
          value={me}
          maxLength={ME_MAX}
          disabled={generating}
          className="h-8 md:text-base"
          onChange={(event) => onMeChange(event.target.value)}
        />
      </div>
      <div className={FIELD}>
        <Label htmlFor="meeting-notes-notes">Notes or transcript</Label>
        <Textarea
          id="meeting-notes-notes"
          rows={12}
          value={notes}
          maxLength={NOTES_MAX}
          disabled={generating}
          className="field-sizing-fixed resize-y md:text-base"
          onChange={(event) => onNotesChange(event.target.value)}
        />
        <span className="text-sm text-muted-foreground">
          {notes.length} of {NOTES_MAX} characters
        </span>
      </div>
      {generating && (
        <span
          role="status"
          className="flex items-center gap-2 text-base text-muted-foreground"
        >
          <Spinner aria-hidden="true" />
          Reading the notes. This can take up to two and a half minutes.
        </span>
      )}
      {!generating && draftError !== null && (
        <ErrorAlert>{draftError}</ErrorAlert>
      )}
    </>
  );
}
