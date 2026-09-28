import { useRef, useState } from "react";
import { Button } from "../../primitives/Button.js";
import { Modal, type ModalControl } from "../../primitives/Modal.js";

interface MergeConfirmModalProps {
  label: string;
  title: string;
  base: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}

export function MergeConfirmModal({
  label,
  title,
  base,
  onConfirm,
  onClose,
}: MergeConfirmModalProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<ModalControl>(null);
  const [busy, setBusy] = useState(false);

  async function handleConfirm() {
    setBusy(true);
    await onConfirm();
    setBusy(false);
    modalRef.current?.requestClose();
  }

  return (
    <Modal
      ariaLabel="Squash merge pull request"
      onClose={onClose}
      controlRef={modalRef}
      initialFocusRef={cancelRef}
    >
      <Modal.Header>Squash and merge {label}?</Modal.Header>
      <Modal.Body>
        <p style={{ margin: 0, color: "var(--text)" }}>
          {title} will be squashed into one commit on {base}. This cannot be
          undone from Dispatch.
        </p>
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
            ref={cancelRef}
            variant="secondary"
            disabled={busy}
            onClick={() => modalRef.current?.requestClose()}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={busy}
            onClick={() => void handleConfirm()}
          >
            Squash and merge
          </Button>
        </div>
      </Modal.Actions>
    </Modal>
  );
}
