import { useRef } from "react";
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

  const blocked = card.cleanupBlocked;
  const summaries =
    (card.sessionSummaries?.length ?? 0) >= 2
      ? card.sessionSummaries
      : undefined;
  const isBlocked =
    summaries == null
      ? blocked != null && blocked.length > 0
      : summaries.some((s) => (s.cleanupBlocked?.length ?? 0) > 0);
  const blockedEntries =
    summaries == null
      ? []
      : summaries.flatMap((s) =>
          (s.cleanupBlocked ?? []).map((entry) => ({
            key: `${s.id}:${entry.repo}`,
            ordinal: s.ordinal,
            repo: entry.repo,
            count: entry.count,
          })),
        );

  const handleConfirm = (force: boolean) => {
    onConfirm(force);
    modalRef.current?.requestClose();
  };

  return (
    <Modal
      ariaLabel="Clean up workspace"
      onClose={onClose}
      controlRef={modalRef}
      initialFocusRef={keepRef}
    >
      <Modal.Header>{card.identifier}</Modal.Header>
      <Modal.Body>
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
                color: "var(--destructive-text)",
                fontWeight: "var(--weight-semibold)",
              }}
            >
              Uncommitted work would be lost
            </div>
            {summaries == null
              ? blocked?.map((entry) => (
                  <div key={entry.repo} style={{ color: "var(--text)" }}>
                    {`${entry.repo}: ${entry.count} uncommitted file${
                      entry.count === 1 ? "" : "s"
                    }`}
                  </div>
                ))
              : blockedEntries.map((entry) => (
                  <div key={entry.key} style={{ color: "var(--text)" }}>
                    {`Session ${entry.ordinal} (${entry.repo}): ${
                      entry.count
                    } uncommitted file${entry.count === 1 ? "" : "s"}`}
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
            {summaries == null
              ? "Clean up workspace? Kills the session and removes worktrees; branches are kept."
              : `Clean up all ${summaries.length} sessions? Kills each session and removes its worktrees; branches are kept.`}
          </div>
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
            style={{
              padding: "0 var(--space-lg)",
              fontFamily: "var(--font-ui)",
            }}
          >
            Keep workspace
          </Button>
          {isBlocked ? (
            <Button variant="danger" onClick={() => handleConfirm(true)}>
              Discard uncommitted changes and clean up
            </Button>
          ) : (
            <Button variant="primary" onClick={() => handleConfirm(false)}>
              Clean up
            </Button>
          )}
        </div>
      </Modal.Actions>
    </Modal>
  );
}
