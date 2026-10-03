import { useEffect, useRef, useState } from "react";
import { useSingleFlight } from "@/queries/single-flight";
import {
  MeetingNotesDialog,
  type NotesPhase,
} from "@/modules/meetings/components/MeetingNotesDialog";
import { MeetingNotesForm } from "@/modules/meetings/components/MeetingNotesForm";
import { MeetingNotesReview } from "@/modules/meetings/components/MeetingNotesReview";
import {
  checkedDrafts,
  createErrorCopy,
  draftErrorCopy,
  hasBlankCheckedTitle,
  toReviewRows,
  type ReviewRow,
} from "@/modules/meetings/domain/draft-rows";
import { useMeetingName } from "@/modules/meetings/hooks/use-meeting-name";
import {
  useCreateMeetingItemsMutation,
  useDraftMeetingItemsMutation,
} from "@/modules/meetings/queries/meetings-queries";

interface MeetingNotesContainerProps {
  onClose: () => void;
  onCreated: (result: {
    created: number;
    updated: number;
    notesSaved: boolean;
  }) => void;
}

export function MeetingNotesContainer({
  onClose,
  onCreated,
}: MeetingNotesContainerProps) {
  const meetingRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const { name: me, setName: setMe, save: saveName } = useMeetingName();

  const [phase, setPhase] = useState<NotesPhase>("paste");
  const [meeting, setMeeting] = useState("");
  const [notes, setNotes] = useState("");
  const [draftError, setDraftError] = useState<string | null>(null);
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [createError, setCreateError] = useState<string | null>(null);

  const draft = useDraftMeetingItemsMutation();
  const create = useCreateMeetingItemsMutation((result) => {
    if (result.ok) {
      onCreated({
        created: result.created,
        updated: result.updated,
        notesSaved: result.notesSaved,
      });
      if (mountedRef.current) onClose();
      return;
    }
    if (mountedRef.current) setCreateError(createErrorCopy(result.error));
  });
  const submitDraft = useSingleFlight(draft.mutate);
  const submitCreate = useSingleFlight(create.mutate);

  const trimmedMeeting = meeting.trim();
  const canDraft = trimmedMeeting !== "" && notes.trim() !== "";
  const checkedCount = rows.filter((row) => row.checked).length;
  const blankTitle = hasBlankCheckedTitle(rows);
  const canCreate = !create.isPending && checkedCount > 0 && !blankTitle;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  function handleDraft() {
    if (abortRef.current !== null) return;
    const name = me.trim();
    saveName(name);
    const controller = new AbortController();
    abortRef.current = controller;
    setDraftError(null);
    setPhase("generating");
    submitDraft(
      {
        meeting: trimmedMeeting,
        notes,
        me: name,
        signal: controller.signal,
      },
      {
        onSettled: () => {
          abortRef.current = null;
        },
        onSuccess: (result) => {
          if (result.ok) {
            setRows(toReviewRows(result.drafts));
            setCreateError(null);
            setPhase("review");
            return;
          }
          setDraftError(draftErrorCopy(result.error));
          setPhase("paste");
        },
        onError: (error) => {
          if (!(error instanceof DOMException && error.name === "AbortError")) {
            setDraftError(draftErrorCopy(null));
          }
          setPhase("paste");
        },
      },
    );
  }

  function handleBack() {
    setRows([]);
    setCreateError(null);
    setPhase("paste");
  }

  function handleCreate() {
    setCreateError(null);
    submitCreate({
      meeting: trimmedMeeting,
      drafts: checkedDrafts(rows),
      notes,
    });
  }

  return (
    <MeetingNotesDialog
      phase={phase}
      canDraft={canDraft}
      canCreate={canCreate}
      creating={create.isPending}
      hasRows={rows.length > 0}
      checkedCount={checkedCount}
      initialFocusRef={meetingRef}
      onClose={onClose}
      onDraft={handleDraft}
      onCancel={() => abortRef.current?.abort()}
      onBack={handleBack}
      onCreate={handleCreate}
    >
      {phase === "review" ? (
        <MeetingNotesReview
          rows={rows}
          meeting={trimmedMeeting}
          creating={create.isPending}
          blankTitle={blankTitle}
          createError={createError}
          onRowChange={(index, next) =>
            setRows((current) =>
              current.map((row, i) => (i === index ? next : row)),
            )
          }
        />
      ) : (
        <MeetingNotesForm
          meeting={meeting}
          me={me}
          notes={notes}
          generating={phase === "generating"}
          draftError={draftError}
          meetingRef={meetingRef}
          onMeetingChange={setMeeting}
          onMeChange={setMe}
          onNotesChange={setNotes}
        />
      )}
    </MeetingNotesDialog>
  );
}
