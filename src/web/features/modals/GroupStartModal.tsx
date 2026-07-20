import { useCallback, useRef, useState } from "react";
import type { Card as CardModel } from "../../../shared/types.js";
import { startGroup } from "../../lib/api.js";
import { Button } from "../../primitives/Button.js";
import { Field } from "../../primitives/Field.js";
import { Modal, type ModalControl } from "../../primitives/Modal.js";
import { Notice } from "../../primitives/Notice.js";
import { MemberRow } from "../board/index.js";
import { StartModal } from "./StartModal.js";

interface GroupStartModalProps {
  members: CardModel[];
  onClose: () => void;
  onStarted?: () => void;
}

const focusRing = (on: boolean): string =>
  on ? "0 0 0 2px var(--accent)" : "none";

export function GroupStartModal({
  members,
  onClose,
  onStarted,
}: GroupStartModalProps) {
  const titleRef = useRef<HTMLInputElement>(null);
  const modalRef = useRef<ModalControl>(null);
  const [title, setTitle] = useState(() =>
    members.map((m) => m.identifier).join(" + "),
  );
  const [extraDirection, setExtraDirection] = useState("");
  const [error, setError] = useState<{
    text: string;
    variant: "config" | "playbook" | "ineligible" | null;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [titleFocus, setTitleFocus] = useState(false);
  const [textareaFocus, setTextareaFocus] = useState(false);

  const clearError = useCallback(() => setError(null), []);
  const workspace = StartModal.useWorkspacePicker(clearError);
  const playbook = StartModal.usePlaybookPicker(clearError);

  const { repos, checked, baseOverride, selectedFolder } = workspace;
  const { playbookArg, reload: reloadPlaybooks } = playbook;

  const checkedCount = (repos ?? []).filter((r) => checked[r.path]).length;
  const startDisabled =
    submitting ||
    title.trim() === "" ||
    error?.variant === "config" ||
    selectedFolder === null ||
    checkedCount === 0;

  async function handleStart() {
    if (startDisabled) return;
    setSubmitting(true);
    setError(null);
    try {
      const chosen = (repos ?? [])
        .filter((r) => checked[r.path])
        .map((r) => ({ path: r.path, base: baseOverride[r.path] ?? r.base }));
      const result = await startGroup({
        title: title.trim(),
        memberIds: members.map((m) => m.id),
        folder: selectedFolder ?? "",
        repos: chosen,
        playbook: playbookArg,
        extraDirection,
      });
      if (result.ok) {
        onStarted?.();
        modalRef.current?.requestClose();
        return;
      }
      if (result.variant === "playbook") {
        setError({
          text: "The selected playbook no longer exists.",
          variant: "playbook",
        });
        void reloadPlaybooks();
        return;
      }
      setError({
        text: result.error,
        variant:
          result.variant === "config" || result.variant === "ineligible"
            ? result.variant
            : null,
      });
    } catch (err) {
      console.error("startGroup failed", err);
      setError({
        text: "Couldn't reach the server. Try again.",
        variant: null,
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      ariaLabel="New group"
      onClose={onClose}
      controlRef={modalRef}
      initialFocusRef={titleRef}
      dialogStyle={{ maxHeight: "80vh" }}
    >
      <Modal.Header>New group</Modal.Header>
      <Modal.Body>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-xs)",
          }}
        >
          <Field>Title</Field>
          <input
            ref={titleRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onFocus={() => setTitleFocus(true)}
            onBlur={() => setTitleFocus(false)}
            aria-label="Title"
            style={{
              height: "32px",
              padding: "0 var(--space-sm)",
              background: "var(--surface-card)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
              color: "var(--text)",
              fontFamily: "var(--font-ui)",
              fontSize: "var(--font-body)",
              lineHeight: "var(--line-body)",
              outline: "none",
              boxShadow: focusRing(titleFocus),
            }}
          />
        </div>

        <StartModal.WorkspacePicker
          workspace={workspace}
          onInteraction={clearError}
        />

        <StartModal.PlaybookPicker
          playbook={playbook}
          onEditPlaybooks={() => {}}
        />

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-xs)",
          }}
        >
          <Field>{`Members (${members.length})`}</Field>
          {members.map((member) => (
            <MemberRow key={member.id} member={member} />
          ))}
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-sm)",
            flex: "0 0 auto",
          }}
        >
          <textarea
            value={extraDirection}
            onChange={(e) => setExtraDirection(e.target.value)}
            onFocus={() => setTextareaFocus(true)}
            onBlur={() => setTextareaFocus(false)}
            aria-label="Prompt for Claude"
            placeholder="Optional direction for Claude — applies to the whole group. Press Start to launch."
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
              boxShadow: focusRing(textareaFocus),
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
            {error.variant === "config" ? (
              <>
                <Notice
                  tone="destructive"
                  label="Can't start — a selected repo is missing"
                />
                <div
                  style={{
                    fontSize: "var(--font-body)",
                    lineHeight: "var(--line-body)",
                    color: "var(--text-muted)",
                  }}
                >
                  One of the chosen repositories no longer exists on disk.
                  Reopen the workspace and re-pick.
                </div>
              </>
            ) : error.variant === "playbook" ? (
              <>
                <Notice
                  tone="destructive"
                  label="Can't start — that playbook is gone"
                />
                <div
                  style={{
                    fontSize: "var(--font-body)",
                    lineHeight: "var(--line-body)",
                    color: "var(--text-muted)",
                  }}
                >
                  The selected playbook was deleted. The list has refreshed —
                  pick another and press Start again.
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
      </Modal.Body>
      <Modal.Actions>
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            flex: "0 0 auto",
          }}
        >
          <Button
            variant="primary"
            onClick={() => void handleStart()}
            disabled={startDisabled}
          >
            Start group
          </Button>
        </div>
      </Modal.Actions>
    </Modal>
  );
}
