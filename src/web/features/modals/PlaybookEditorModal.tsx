import { useRef, useState } from "react";
import type { Playbook } from "../../../shared/types.js";
import { createPlaybook, updatePlaybook } from "../../lib/api.js";
import { Button } from "../../primitives/Button.js";
import { Field } from "../../primitives/Field.js";
import { Modal, type ModalControl } from "../../primitives/Modal.js";
import { Notice } from "../../primitives/Notice.js";

const focusRing = (on: boolean): string =>
  on ? "0 0 0 2px var(--accent)" : "none";

const FOOTGUN_MESSAGE =
  "Playbook body can't contain the text DISPATCH_STATUS: — remove it and try again.";
const COLLISION_MESSAGE = "A playbook with that name already exists";

interface StageOptionButtonProps {
  label: string;
  active: boolean;
  onClick: () => void;
}

function StageOptionButton({ label, active, onClick }: StageOptionButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "0 0 var(--space-xs)",
        background: "transparent",
        border: "none",
        borderBottom: active
          ? "2px solid var(--accent)"
          : "2px solid transparent",
        color: active ? "var(--text)" : "var(--text-muted)",
        fontFamily: "var(--font-ui)",
        fontSize: "var(--font-label)",
        fontWeight: "var(--weight-semibold)",
        lineHeight: "var(--line-label)",
        cursor: "pointer",
        outline: "none",
      }}
    >
      {label}
    </button>
  );
}

interface PlaybookEditorModalProps {
  mode: "create" | "edit";
  playbook?: Playbook;
  existingNames: string[];
  onSaved: () => void;
  onClose: () => void;
}

export function PlaybookEditorModal({
  mode,
  playbook,
  existingNames,
  onSaved,
  onClose,
}: PlaybookEditorModalProps) {
  const modalRef = useRef<ModalControl>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(playbook?.name ?? "");
  const [stage, setStage] = useState<"planning" | "implementation">(
    playbook?.stage ?? "planning",
  );
  const [body, setBody] = useState(playbook?.body ?? "");
  const [nameFocus, setNameFocus] = useState(false);
  const [bodyFocus, setBodyFocus] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [footgunError, setFootgunError] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [saving, setSaving] = useState(false);

  const trimmedName = name.trim();
  const hasFootgun = body.includes("DISPATCH_STATUS:");
  const canSave = trimmedName !== "" && !saving && !hasFootgun;

  function checkNameCollision() {
    const lower = trimmedName.toLowerCase();
    if (lower === "") return;
    const collides = existingNames.some((n) => n.toLowerCase() === lower);
    setNameError(collides ? COLLISION_MESSAGE : null);
  }

  async function handleSave() {
    if (!canSave) return;
    if (mode === "edit" && playbook?.slug === undefined) return;
    setSaving(true);
    setSaveError(false);
    setFootgunError(false);
    try {
      const input = { name: trimmedName, stage, body };
      const result =
        mode === "create"
          ? await createPlaybook(input)
          : await updatePlaybook(playbook!.slug!, input);
      if (result.ok) {
        onSaved();
        return;
      }
      if (result.error === "name-exists") {
        setNameError(COLLISION_MESSAGE);
        return;
      }
      if (result.error === "footgun") {
        setFootgunError(true);
        return;
      }
      setSaveError(true);
    } catch (err) {
      console.error("playbook save failed", err);
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      ariaLabel={
        mode === "edit" ? `Edit ${playbook?.name ?? ""}` : "New playbook"
      }
      title={mode === "edit" ? (playbook?.name ?? "") : "New playbook"}
      onClose={onClose}
      controlRef={modalRef}
      initialFocusRef={nameInputRef}
      dialogStyle={{ maxHeight: "80vh" }}
      footer={
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: "var(--space-sm)",
            flex: "0 0 auto",
          }}
        >
          <Button variant="secondary" onClick={onClose}>
            Discard changes
          </Button>
          <Button
            variant="primary"
            disabled={!canSave}
            aria-busy={saving}
            onClick={() => void handleSave()}
          >
            Save playbook
          </Button>
        </div>
      }
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-lg)",
          flex: "1 1 auto",
          minHeight: 0,
          overflowY: "auto",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-xs)",
          }}
        >
          <Field>Name</Field>
          <input
            ref={nameInputRef}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setNameError(null);
            }}
            onFocus={() => setNameFocus(true)}
            onBlur={() => {
              setNameFocus(false);
              checkNameCollision();
            }}
            aria-label="Playbook name"
            placeholder="Playbook name"
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
              boxShadow: focusRing(nameFocus),
            }}
          />
          {nameError !== null && (
            <div
              role="alert"
              style={{
                fontSize: "var(--font-label)",
                fontWeight: "var(--weight-semibold)",
                lineHeight: "var(--line-label)",
                color: "var(--destructive)",
              }}
            >
              {nameError}
            </div>
          )}
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-xs)",
          }}
        >
          <Field>Stage</Field>
          <div style={{ display: "flex", gap: "var(--space-lg)" }}>
            <StageOptionButton
              label="Planning"
              active={stage === "planning"}
              onClick={() => setStage("planning")}
            />
            <StageOptionButton
              label="Implementation"
              active={stage === "implementation"}
              onClick={() => setStage("implementation")}
            />
          </div>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-xs)",
            flex: "1 1 auto",
            minHeight: 0,
          }}
        >
          <Field>Body</Field>
          <textarea
            value={body}
            onChange={(e) => {
              setBody(e.target.value);
              setFootgunError(false);
            }}
            onFocus={() => setBodyFocus(true)}
            onBlur={() => setBodyFocus(false)}
            aria-label="Playbook body"
            style={{
              minHeight: "240px",
              resize: "vertical",
              padding: "var(--space-sm)",
              background: "var(--surface-card)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
              color: "var(--text)",
              fontFamily: "var(--font-mono)",
              fontSize: "var(--font-body)",
              lineHeight: "var(--line-body)",
              outline: "none",
              boxShadow: focusRing(bodyFocus),
            }}
          />
          {footgunError && (
            <div
              role="alert"
              style={{
                fontSize: "var(--font-label)",
                fontWeight: "var(--weight-semibold)",
                lineHeight: "var(--line-label)",
                color: "var(--destructive)",
              }}
            >
              {FOOTGUN_MESSAGE}
            </div>
          )}
        </div>

        {saveError && (
          <Notice
            tone="destructive"
            label="Couldn't save playbook — try again."
          />
        )}
      </div>
    </Modal>
  );
}
