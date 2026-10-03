import { ErrorAlert } from "@/components/ErrorAlert";
import { LoadingButton } from "@/components/LoadingButton";

interface MeetingTranscriptProps {
  visible: boolean;
  loading: boolean;
  failed: boolean;
  text: string | null;
  onToggle: () => void;
}

export function MeetingTranscript({
  visible,
  loading,
  failed,
  text,
  onToggle,
}: MeetingTranscriptProps) {
  return (
    <div className="flex flex-col items-start gap-2">
      <LoadingButton
        variant="secondary"
        loading={loading}
        aria-expanded={visible}
        onClick={onToggle}
      >
        {visible ? "Hide transcript" : "Load transcript"}
      </LoadingButton>
      {failed ? (
        <ErrorAlert>Couldn&apos;t load the transcript.</ErrorAlert>
      ) : null}
      {visible && text != null ? (
        <div className="max-h-[50vh] w-full overflow-y-auto rounded-md border border-border bg-card p-2 text-base wrap-anywhere whitespace-pre-wrap text-foreground">
          {text}
        </div>
      ) : null}
    </div>
  );
}
