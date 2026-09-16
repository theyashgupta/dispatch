import { useRef } from "react";
import type { Card as CardModel } from "../../../shared/types.js";
import { Button } from "../../primitives/Button.js";
import { Modal, type ModalControl } from "../../primitives/Modal.js";

interface ResetModalProps {
  card: CardModel;
  onConfirm: () => void;
  onClose: () => void;
}

export function ResetModal({ card, onConfirm, onClose }: ResetModalProps) {
  const keepRef = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<ModalControl>(null);

  const sessionCount = card.sessionCount ?? 1;
  const items: string[] = [];
  if (sessionCount > 1) {
    items.push(`${sessionCount} Claude sessions`);
    items.push("Each session's workspace folder and local branch");
  } else {
    if (card.tmuxSession != null || card.sessionLost === true) {
      items.push("The Claude session");
    }
    if (card.workspacePath != null) {
      items.push(`Workspace folder ${card.workspacePath}`);
    }
    if (card.branch != null) items.push(`Local branch ${card.branch}`);
  }

  return (
    <Modal
      ariaLabel="Reset ticket"
      onClose={onClose}
      controlRef={modalRef}
      initialFocusRef={keepRef}
    >
      <Modal.Header>{card.identifier}</Modal.Header>
      <Modal.Body>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-xs)",
            fontFamily: "var(--font-ui)",
            fontSize: "var(--font-body)",
            lineHeight: "var(--line-body)",
            color: "var(--text)",
          }}
        >
          <div
            style={{
              color: "var(--destructive-text)",
              fontWeight: "var(--weight-semibold)",
            }}
          >
            Reset deletes
          </div>
          {items.map((item) => (
            <div key={item}>{item}</div>
          ))}
          <div style={{ color: "var(--text-muted)" }}>
            Uncommitted changes are lost. Pushed branches and open PRs are not
            touched. The ticket returns to the Inbox as if never started.
          </div>
        </div>
      </Modal.Body>
      <Modal.Actions>
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: "var(--space-sm)",
            flex: "0 0 auto",
          }}
        >
          <Button
            ref={keepRef}
            variant="secondary"
            onClick={() => modalRef.current?.requestClose()}
            style={{
              padding: "0 var(--space-lg)",
              fontFamily: "var(--font-ui)",
            }}
          >
            Keep everything
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              onConfirm();
              modalRef.current?.requestClose();
            }}
          >
            Reset to Inbox
          </Button>
        </div>
      </Modal.Actions>
    </Modal>
  );
}
