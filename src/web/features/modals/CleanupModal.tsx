import { useEffect, useRef, useState } from "react";
import type { Card as CardModel } from "../../../shared/types.js";
import { Button } from "../../primitives/Button.js";
import { Modal, type ModalControl } from "../../primitives/Modal.js";

interface CleanupModalProps {
  card: CardModel;
  onConfirm: (force: boolean) => void;
  onClose: () => void;
}

export function CleanupModal({ card, onConfirm, onClose }: CleanupModalProps) {
  const keepRef = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<ModalControl>(null);
  const [pending, setPending] = useState(false);

  const blocked = card.cleanupBlocked;
  const isBlocked = blocked != null && blocked.length > 0;

  useEffect(() => {
    setPending(false);
  }, [isBlocked]);

  const handleConfirm = (force: boolean) => {
    if (pending) return;
    setPending(true);
    onConfirm(force);
  };

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
          {isBlocked ? (
            <Button
              variant="danger"
              disabled={pending}
              onClick={() => handleConfirm(true)}
            >
              Discard uncommitted changes and clean up
            </Button>
          ) : (
            <Button
              variant="primary"
              disabled={pending}
              onClick={() => handleConfirm(false)}
            >
              Clean up
            </Button>
          )}
        </div>
      }
    >
      {isBlocked ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-xs)",
            fontFamily: "var(--font-ui)",
            fontSize: "var(--font-body)",
            lineHeight: "var(--line-body)",
          }}
        >
          <div
            style={{
              color: "var(--destructive)",
              fontWeight: "var(--weight-semibold)",
            }}
          >
            Uncommitted work would be lost
          </div>
          {blocked.map((entry) => (
            <div key={entry.repo} style={{ color: "var(--text)" }}>
              {`${entry.repo}: ${entry.count} uncommitted file${
                entry.count === 1 ? "" : "s"
              }`}
            </div>
          ))}
        </div>
      ) : (
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
      )}
    </Modal>
  );
}
