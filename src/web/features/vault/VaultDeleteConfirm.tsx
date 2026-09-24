import { useRef, useState } from "react";
import type { VaultKeySummary } from "../../../shared/types.js";
import { deleteVaultKey } from "../../lib/api.js";
import { Button } from "../../primitives/Button.js";
import { Modal, type ModalControl } from "../../primitives/Modal.js";
import { Notice } from "../../primitives/Notice.js";

interface VaultDeleteConfirmProps {
  keySummary: VaultKeySummary;
  onClose: () => void;
  onDeleted: () => void;
}

export function VaultDeleteConfirm({
  keySummary,
  onClose,
  onDeleted,
}: VaultDeleteConfirmProps) {
  const modalRef = useRef<ModalControl>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);

  async function handleDelete() {
    if (pending) return;
    setPending(true);
    keepRef.current?.focus();
    setError(false);
    try {
      const result = await deleteVaultKey(keySummary.name);
      if (result.ok) {
        onDeleted();
        return;
      }
      setError(true);
    } catch (err) {
      console.error("deleteVaultKey failed", err);
      setError(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal
      ariaLabel={`Delete ${keySummary.name}`}
      onClose={onClose}
      controlRef={modalRef}
      initialFocusRef={keepRef}
    >
      <Modal.Header>{keySummary.name}</Modal.Header>
      <Modal.Body>
        <div
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "var(--font-body)",
            lineHeight: "var(--line-body)",
            color: "var(--text)",
          }}
        >
          Delete this key? Any command that depends on it will stop finding the
          value. This can't be undone.
        </div>
        {error && (
          <Notice tone="destructive" label="Couldn't delete key, try again." />
        )}
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
          >
            Keep key
          </Button>
          <Button
            variant="danger"
            loading={pending}
            onClick={() => void handleDelete()}
          >
            {pending ? "Deleting key..." : "Delete key"}
          </Button>
        </div>
      </Modal.Actions>
    </Modal>
  );
}
