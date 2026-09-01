import { useEffect, useRef, useState } from "react";
import type { Card as CardModel } from "../../../shared/types.js";
import { Button } from "../../primitives/Button.js";
import { Modal, type ModalControl } from "../../primitives/Modal.js";
import { Notice } from "../../primitives/Notice.js";

interface CleanupModalProps {
  card: CardModel;
  onConfirm: (force: boolean) => Promise<void>;
  onClose: () => void;
}

export function CleanupModal({ card, onConfirm, onClose }: CleanupModalProps) {
  const keepRef = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<ModalControl>(null);
  const [pending, setPending] = useState(false);
  const [confirmError, setConfirmError] = useState(false);
  const attemptRef = useRef<number | undefined>(undefined);

  const blocked = card.cleanupBlocked;
  const summaries = card.sessionSummaries;
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

  useEffect(() => {
    if (pending && card.cleanupAttempt !== attemptRef.current)
      setPending(false);
  }, [card.cleanupAttempt, pending]);

  const handleConfirm = async (force: boolean) => {
    if (pending) return;
    attemptRef.current = card.cleanupAttempt;
    setPending(true);
    setConfirmError(false);
    keepRef.current?.focus();
    try {
      await onConfirm(force);
    } catch {
      setConfirmError(true);
      setPending(false);
    }
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
                    {`Session ${entry.ordinal} — ${entry.repo}: ${
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
        {confirmError && (
          <div role="alert" style={{ marginTop: "var(--space-sm)" }}>
            <Notice
              tone="destructive"
              label="Couldn't reach the server — try again."
            />
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
            <Button
              variant="danger"
              loading={pending}
              onClick={() => void handleConfirm(true)}
            >
              {pending
                ? "Cleaning up…"
                : "Discard uncommitted changes and clean up"}
            </Button>
          ) : (
            <Button
              variant="primary"
              loading={pending}
              onClick={() => void handleConfirm(false)}
            >
              {pending ? "Cleaning up…" : "Clean up"}
            </Button>
          )}
        </div>
      </Modal.Actions>
    </Modal>
  );
}
