import { useRef, useState } from "react";
import type { Card as CardModel } from "../../shared/types.js";
import { startCard } from "../lib/api.js";
import { Button } from "../primitives/Button.js";
import { Modal, type ModalControl } from "../primitives/Modal.js";
import { Notice } from "../primitives/Notice.js";

interface StartModalProps {
  card: CardModel;
  onClose: () => void;
}

export function StartModal({ card, onClose }: StartModalProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const modalRef = useRef<ModalControl>(null);
  const [extraDirection, setExtraDirection] = useState(
    card.extraDirection ?? "",
  );
  const [error, setError] = useState<{
    text: string;
    isConfig: boolean;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [focused, setFocused] = useState<"textarea" | null>(null);

  async function handleStart() {
    if (submitting || (error && error.isConfig)) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await startCard(card.id, extraDirection);
      if (result.ok) {
        modalRef.current?.requestClose();
        return;
      }
      setError({
        text: result.error,
        isConfig: result.variant === "config",
      });
    } catch (err) {
      console.error("startCard failed", err);
      setError({
        text: "Couldn't reach the server. Try again.",
        isConfig: false,
      });
    } finally {
      setSubmitting(false);
    }
  }

  const startDisabled = submitting || (error?.isConfig ?? false);

  return (
    <Modal
      ariaLabel="Start session"
      title={card.identifier}
      onClose={onClose}
      controlRef={modalRef}
      initialFocusRef={textareaRef}
      dialogStyle={{ maxHeight: "80vh" }}
      footer={
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            flex: "0 0 auto",
          }}
        >
          <Button
            variant="primary"
            onClick={handleStart}
            disabled={startDisabled}
          >
            Start
          </Button>
        </div>
      }
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-sm)",
          flex: "0 0 auto",
        }}
      >
        <textarea
          ref={textareaRef}
          value={extraDirection}
          onChange={(e) => setExtraDirection(e.target.value)}
          onFocus={() => setFocused("textarea")}
          onBlur={() => setFocused(null)}
          aria-label="Prompt for Claude"
          placeholder="Optional direction for Claude — press Start to launch"
          style={{
            minHeight: "96px",
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
            boxShadow:
              focused === "textarea" ? "0 0 0 2px var(--accent)" : "none",
          }}
        />
      </div>

      {error && (
        <div
          role="alert"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-xs)",
            flex: "0 0 auto",
          }}
        >
          {error.isConfig ? (
            <>
              <Notice
                tone="destructive"
                label="Can't start — repository config missing"
              />
              <div
                style={{
                  fontSize: "var(--font-body)",
                  lineHeight: "var(--line-body)",
                  color: "var(--text-muted)",
                }}
              >
                Set repoPaths and baseBranches in ~/.dispatch/config.json, then
                restart the backend.
              </div>
            </>
          ) : (
            <div
              style={{
                fontSize: "var(--font-body)",
                lineHeight: "var(--line-body)",
                color: "var(--destructive)",
              }}
            >
              {error.text}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
