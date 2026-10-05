import { useState } from "react";
import { MeetingTranscript } from "@/modules/meetings/components/MeetingTranscript";
import { useLoadMeetingTranscript } from "@/modules/meetings/queries/meetings-queries";

interface MeetingTranscriptContainerProps {
  meetingId: string;
}

export function MeetingTranscriptContainer({
  meetingId,
}: MeetingTranscriptContainerProps) {
  const [requested, setRequested] = useState(false);
  const [hidden, setHidden] = useState(false);
  const query = useLoadMeetingTranscript(meetingId, requested);
  const loading = requested && query.isFetching;
  const loaded = requested && !loading && query.isSuccess;

  function handleToggle() {
    if (!requested) setRequested(true);
    else if (loaded) setHidden((value) => !value);
    else void query.refetch();
  }

  return (
    <MeetingTranscript
      visible={loaded && !hidden}
      loading={loading}
      failed={requested && !loading && query.isError}
      text={query.data ?? null}
      onToggle={handleToggle}
    />
  );
}
