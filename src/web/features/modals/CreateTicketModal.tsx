import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createLocalTicket, generateTicketDraft } from "../../lib/api.js";
import { Button } from "../../primitives/Button.js";
import { Field } from "../../primitives/Field.js";
import { Modal, type ModalControl } from "../../primitives/Modal.js";
import { Notice } from "../../primitives/Notice.js";

interface CreateTicketModalProps {
  onClose: () => void;
}

type Phase = "prompt" | "generating" | "review";

const focusRing = (on: boolean): string =>
  on ? "0 0 0 2px var(--accent)" : "none";

const captionStyle: CSSProperties = {
  fontSize: "var(--font-body)",
  lineHeight: "var(--line-body)",
  color: "var(--text-muted)",
};

const inlineErrorStyle: CSSProperties = {
  fontSize: "var(--font-body)",
  lineHeight: "var(--line-body)",
  color: "var(--destructive)",
};

function acceptErrorCopy(error: string | null): string {
  switch (error) {
    case "invalid-title":
      return "Title is too long (max 300 characters).";
    case "invalid-description":
      return "Description is too long (max 20,000 characters).";
    case "content contains the DISPATCH_STATUS marker":
      return "The ticket can't contain the reserved DISPATCH_STATUS marker.";
    default:
      return "Couldn't reach the server. Try again.";
  }
}

export function CreateTicketModal({ onClose }: CreateTicketModalProps) {
  const modalRef = useRef<ModalControl>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const [phase, setPhase] = useState<Phase>("prompt");
  const [prompt, setPrompt] = useState("");
  const [generateFailed, setGenerateFailed] = useState(false);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [draftNotice, setDraftNotice] = useState(false);
  const [editedSinceGenerate, setEditedSinceGenerate] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);

  const [promptFocus, setPromptFocus] = useState(false);
  const [titleFocus, setTitleFocus] = useState(false);
  const [descriptionFocus, setDescriptionFocus] = useState(false);

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
      const result = await generateTicketDraft(direction, controller.signal);
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
      if (err instanceof DOMException && err.name === "AbortError") {
        setPhase(isRegenerate ? "review" : "prompt");
        return;
      }
      setGenerateFailed(true);
      setPhase(isRegenerate ? "review" : "prompt");
    }
  }

  function handleCancelGenerate() {
    abortControllerRef.current?.abort();
  }

  function handleTitleChange(value: string) {
    setTitle(value);
    setEditedSinceGenerate(true);
    setDraftNotice(false);
  }

  function handleDescriptionChange(value: string) {
    setDescription(value);
    setEditedSinceGenerate(true);
    setDraftNotice(false);
  }

  async function handleAccept() {
    const trimmedTitle = title.trim();
    const trimmedDescription = description.trim();
    if (trimmedTitle === "" || trimmedDescription === "") return;
    setAccepting(true);
    titleInputRef.current?.focus();
    setAcceptError(null);
    const result = await createLocalTicket(trimmedTitle, trimmedDescription);
    if (result.ok) {
      onClose();
      return;
    }
    setAcceptError(acceptErrorCopy(result.error));
    setAccepting(false);
  }

  const trimmedPrompt = prompt.trim();
  const canAccept =
    !accepting && title.trim() !== "" && description.trim() !== "";

  return (
    <Modal
      ariaLabel="New ticket"
      onClose={onClose}
      controlRef={modalRef}
      initialFocusRef={textareaRef}
    >
      <Modal.Header>New ticket</Modal.Header>
      <Modal.Body>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-lg)",
          }}
        >
          {phase !== "review" && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-xs)",
              }}
            >
              <Field>What do you want to build or fix?</Field>
              <textarea
                ref={textareaRef}
                value={prompt}
                disabled={phase === "generating"}
                onChange={(e) => setPrompt(e.target.value)}
                onFocus={() => setPromptFocus(true)}
                onBlur={() => setPromptFocus(false)}
                aria-label="What do you want to build or fix?"
                placeholder="Describe the ticket in as much detail as you can — Claude will draft the title and description."
                style={{
                  minHeight: "160px",
                  resize: "vertical",
                  padding: "var(--space-sm)",
                  background: "var(--surface-card)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius)",
                  color: "var(--text)",
                  fontFamily: "var(--font-ui)",
                  fontSize: "var(--font-body)",
                  lineHeight: "var(--line-body)",
                  outline: "none",
                  boxShadow: focusRing(promptFocus),
                }}
              />
            </div>
          )}

          {phase === "generating" && (
            <span style={captionStyle}>
              Drafting your ticket — this can take up to a couple of minutes.
            </span>
          )}

          {phase !== "review" && generateFailed && (
            <Notice
              tone="destructive"
              label="Couldn't generate a ticket — try again."
            />
          )}

          {phase === "review" && (
            <>
              {draftNotice && (
                <Notice tone="muted">
                  Generated — review and edit before accepting.
                </Notice>
              )}

              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "var(--space-xs)",
                }}
              >
                <Field>Title</Field>
                <input
                  ref={titleInputRef}
                  value={title}
                  onChange={(e) => handleTitleChange(e.target.value)}
                  onFocus={() => setTitleFocus(true)}
                  onBlur={() => setTitleFocus(false)}
                  aria-label="Title"
                  style={{
                    height: "32px",
                    padding: "0 var(--space-sm)",
                    background: "var(--surface-card)",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius)",
                    color: "var(--text)",
                    fontFamily: "var(--font-ui)",
                    fontSize: "var(--font-body)",
                    lineHeight: "var(--line-body)",
                    outline: "none",
                    boxShadow: focusRing(titleFocus),
                  }}
                />
              </div>

              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "var(--space-xs)",
                }}
              >
                <Field>Description</Field>
                <textarea
                  value={description}
                  onChange={(e) => handleDescriptionChange(e.target.value)}
                  onFocus={() => setDescriptionFocus(true)}
                  onBlur={() => setDescriptionFocus(false)}
                  aria-label="Description"
                  style={{
                    minHeight: "240px",
                    resize: "vertical",
                    padding: "var(--space-sm)",
                    background: "var(--surface-card)",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius)",
                    color: "var(--text)",
                    fontFamily: "var(--font-ui)",
                    fontSize: "var(--font-body)",
                    lineHeight: "var(--line-body)",
                    outline: "none",
                    boxShadow: focusRing(descriptionFocus),
                  }}
                />
              </div>

              {editedSinceGenerate && (
                <Notice tone="muted">
                  Regenerating replaces your current edits.
                </Notice>
              )}

              {generateFailed && (
                <Notice
                  tone="destructive"
                  label="Couldn't generate a ticket — try again."
                />
              )}

              {acceptError !== null && (
                <div role="alert" style={inlineErrorStyle}>
                  {acceptError}
                </div>
              )}
            </>
          )}
        </div>
      </Modal.Body>
      <Modal.Actions>
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: "var(--space-sm)",
          }}
        >
          {phase === "prompt" && (
            <Button
              variant="primary"
              disabled={trimmedPrompt === ""}
              onClick={() => void runGenerate(trimmedPrompt, false)}
            >
              Generate ticket
            </Button>
          )}

          {phase === "generating" && (
            <>
              <Button variant="secondary" onClick={handleCancelGenerate}>
                Cancel
              </Button>
              <Button variant="primary" disabled aria-busy="true">
                Generating…
              </Button>
            </>
          )}

          {phase === "review" && (
            <>
              <Button
                variant="secondary"
                onClick={onClose}
                disabled={accepting}
              >
                Cancel
              </Button>
              <Button
                variant="secondary"
                disabled={accepting}
                onClick={() => void runGenerate(trimmedPrompt, true)}
              >
                Regenerate
              </Button>
              <Button
                variant="primary"
                disabled={!canAccept}
                loading={accepting}
                onClick={() => void handleAccept()}
              >
                {accepting ? "Creating ticket…" : "Accept ticket"}
              </Button>
            </>
          )}
        </div>
      </Modal.Actions>
    </Modal>
  );
}
