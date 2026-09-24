import { useRef, type CSSProperties } from "react";
import { Button } from "../../primitives/Button.js";
import { Field } from "../../primitives/Field.js";
import { Modal, type ModalControl } from "../../primitives/Modal.js";

interface BulkConfirmModalProps {
  verb: "Clean up" | "Resume";
  identifiers: string[];
  onConfirm: () => void;
  onClose: () => void;
}

const listStyle: CSSProperties = {
  margin: 0,
  padding: "0 0 0 var(--space-lg)",
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-xs)",
  fontSize: "var(--font-body)",
  lineHeight: "var(--line-body)",
  color: "var(--text)",
};

export function BulkConfirmModal({
  verb,
  identifiers,
  onConfirm,
  onClose,
}: BulkConfirmModalProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const firedRef = useRef(false);
  const modalRef = useRef<ModalControl>(null);
  return (
    <Modal
      ariaLabel={`${verb} ${identifiers.length} ${identifiers.length === 1 ? "ticket" : "tickets"}`}
      onClose={onClose}
      controlRef={modalRef}
      initialFocusRef={cancelRef}
    >
      <Modal.Header>{`${verb} ${identifiers.length} ${identifiers.length === 1 ? "ticket" : "tickets"}`}</Modal.Header>
      <Modal.Body>
        <ul style={listStyle} data-testid="bulk-confirm-list">
          {identifiers.map((identifier) => (
            <li key={identifier}>
              <Field mono>{identifier}</Field>
            </li>
          ))}
        </ul>
      </Modal.Body>
      <Modal.Actions>
        <Button
          ref={cancelRef}
          variant="secondary"
          onClick={() => modalRef.current?.requestClose()}
        >
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={() => {
            if (firedRef.current) return;
            firedRef.current = true;
            onConfirm();
            modalRef.current?.requestClose();
          }}
        >
          {verb}
        </Button>
      </Modal.Actions>
    </Modal>
  );
}
