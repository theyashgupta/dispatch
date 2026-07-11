import { useRef } from "react";
import type { Card as CardModel } from "../../../shared/types.js";
import { Button } from "../../primitives/Button.js";
import { Modal, type ModalControl } from "../../primitives/Modal.js";

interface CleanupModalProps {
  card: CardModel;
  onConfirm: () => void;
  onClose: () => void;
}

export function CleanupModal({ card, onConfirm, onClose }: CleanupModalProps) {
  const keepRef = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<ModalControl>(null);

  function handleConfirm() {
    if (!modalRef.current?.beginImmediateClose()) return;
    onConfirm();
  }

  return (
    <Modal
      ariaLabel="Clean up workspace"
      title={card.identifier}
      onClose={onClose}
      controlRef={modalRef}
      initialFocusRef={keepRef}
      footer={
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
            Keep workspace
          </Button>
          <Button variant="primary" onClick={handleConfirm}>
            Clean up
          </Button>
        </div>
      }
    >
      <div
        style={{
          fontFamily: "var(--font-ui)",
          fontSize: "var(--font-body)",
          lineHeight: "var(--line-body)",
          color: "var(--text)",
        }}
      >
        Clean up workspace? Kills the session and removes worktrees; branches
        are kept.
      </div>
    </Modal>
  );
}
