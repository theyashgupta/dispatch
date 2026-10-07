import { useEffect, useRef, useState } from "react";
import { useRouteContext } from "@tanstack/react-router";
import {
  CreateTicketDialog,
  type TicketPhase,
} from "@/modules/card-actions/components/CreateTicketDialog";
import { acceptErrorCopy } from "@/modules/card-actions/domain/ticket-copy";
import { useAppStore } from "@/components/ui/hooks/use-app-store";
import { useDialogClose } from "@/components/ui/hooks/use-dialog-close";
import { closeOverlay } from "@/components/ui/hooks/overlay-return";
import { usePastedImages } from "@/modules/card-actions/hooks/use-pasted-images";
import {
  useCreateLocalTicketMutation,
  useGenerateTicketDraftMutation,
} from "@/queries/cards-queries";

interface CreateTicketContainerProps {
  onClose: () => void;
  onFromMeetingNotes: () => void;
}

export function CreateTicketContainer({
  onClose,
  onFromMeetingNotes,
}: CreateTicketContainerProps) {
  const { appStore } = useRouteContext({ from: "__root__" });
  const { open, requestClose, onOpenChange } = useDialogClose(onClose);
  const draftMutation = useGenerateTicketDraftMutation();
  const createMutation = useCreateLocalTicketMutation(
    useAppStore(appStore, (s) => s.board),
  );
  const titleRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const [phase, setPhase] = useState<TicketPhase>("prompt");
  const [prompt, setPrompt] = useState("");
  const [generateFailed, setGenerateFailed] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [draftNotice, setDraftNotice] = useState(false);
  const [editedSinceGenerate, setEditedSinceGenerate] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);

  const pasted = usePastedImages();
  const imagePayload = pasted.images.map((img) => img.base64);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  async function runGenerate(direction: string, isRegenerate: boolean) {
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setPhase("generating");
    setGenerateFailed(false);
    try {
      const result = await draftMutation.mutateAsync({
        direction,
        signal: controller.signal,
        images: imagePayload,
      });
      if (result.ok) {
        setTitle(result.title);
        setDescription(result.description);
        setEditedSinceGenerate(false);
        setDraftNotice(true);
        setPhase("review");
        return;
      }
      setGenerateFailed(true);
      setPhase(isRegenerate ? "review" : "prompt");
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        setGenerateFailed(true);
      }
      setPhase(isRegenerate ? "review" : "prompt");
    }
  }

  async function handleAccept() {
    const trimmedTitle = title.trim();
    const trimmedDescription = description.trim();
    if (trimmedTitle === "" || trimmedDescription === "") return;
    setAccepting(true);
    titleRef.current?.focus();
    setAcceptError(null);
    const result = await createMutation.mutateAsync({
      title: trimmedTitle,
      description: trimmedDescription,
      images: imagePayload,
    });
    if (result.ok) {
      requestClose();
      return;
    }
    setAcceptError(acceptErrorCopy(result.error));
    setAccepting(false);
  }

  const trimmedPrompt = prompt.trim();

  return (
    <CreateTicketDialog
      open={open}
      onOpenChange={onOpenChange}
      onCancel={requestClose}
      phase={phase}
      prompt={prompt}
      onPromptChange={setPrompt}
      onPaste={pasted.onPaste}
      images={pasted.images}
      limitHit={pasted.limitHit}
      onRemoveImage={pasted.remove}
      generateFailed={generateFailed}
      title={title}
      description={description}
      onTitleChange={(value) => {
        setTitle(value);
        setEditedSinceGenerate(true);
        setDraftNotice(false);
      }}
      onDescriptionChange={(value) => {
        setDescription(value);
        setEditedSinceGenerate(true);
        setDraftNotice(false);
      }}
      titleRef={titleRef}
      draftNotice={draftNotice}
      editedSinceGenerate={editedSinceGenerate}
      acceptError={acceptError}
      accepting={accepting}
      canGenerate={trimmedPrompt !== ""}
      canAccept={!accepting && title.trim() !== "" && description.trim() !== ""}
      onGenerate={() => void runGenerate(trimmedPrompt, false)}
      onRegenerate={() => void runGenerate(trimmedPrompt, true)}
      onCancelGenerate={() => abortControllerRef.current?.abort()}
      onAccept={() => void handleAccept()}
      onFromMeetingNotes={onFromMeetingNotes}
    />
  );
}

export function CreateTicketRequestContainer() {
  const { appStore } = useRouteContext({ from: "__root__" });
  const open = useAppStore(appStore, (s) => s.createTicketOpen);
  if (!open) return null;
  return (
    <CreateTicketContainer
      onClose={() => closeOverlay(appStore, appStore.closeCreateTicket)}
      onFromMeetingNotes={() => {
        appStore.getState().overlayReturn?.focus();
        appStore.closeCreateTicket();
        appStore.openMeetingNotes();
      }}
    />
  );
}
