import { useRef } from "react";
import { Button } from "../../primitives/Button.js";
import { Modal, type ModalControl } from "../../primitives/Modal.js";
import type { VaultTab } from "./VaultPage.js";

interface VaultImportConfirmProps {
  vault: VaultTab;
}

export function VaultImportConfirm({ vault }: VaultImportConfirmProps) {
  const modalRef = useRef<ModalControl>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  return (
    <Modal
      ariaLabel="Import keys from env-vault?"
      onClose={vault.closeImportConfirm}
      controlRef={modalRef}
      initialFocusRef={cancelRef}
    >
      <Modal.Header>Import keys from env-vault?</Modal.Header>
      <Modal.Body>
        <div
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "var(--font-body)",
            lineHeight: "var(--line-body)",
            color: "var(--text)",
          }}
        >
          This copies key names, purposes, and values from your standalone
          env-vault. Keys already here are skipped, never overwritten, and the
          original files are left untouched.
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
            ref={cancelRef}
            variant="secondary"
            onClick={() => modalRef.current?.requestClose()}
          >
            Cancel import
          </Button>
          <Button
            variant="primary"
            loading={vault.importPending}
            onClick={() => void vault.handleImport()}
          >
            {vault.importPending ? "Importing keys..." : "Import keys"}
          </Button>
        </div>
      </Modal.Actions>
    </Modal>
  );
}
