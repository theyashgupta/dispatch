import { useRef, useState } from "react";
import { Sparkles, X } from "lucide-react";
import type { Playbook } from "../../../shared/types.js";
import {
  createPlaybook,
  generatePlaybookDraft,
  updatePlaybook,
} from "../../lib/api.js";
import { Button } from "../../primitives/Button.js";
import { Field } from "../../primitives/Field.js";
import { IconButton } from "../../primitives/IconButton.js";
import { Modal, type ModalControl } from "../../primitives/Modal.js";
import { Notice } from "../../primitives/Notice.js";
import { FolderBrowserModal } from "../workspaces/index.js";

const focusRing = (on: boolean): string =>
  on ? "0 0 0 2px var(--accent)" : "none";

const FOOTGUN_MESSAGE =
  "Playbook body can't contain the text DISPATCH_STATUS: — remove it and try again.";
const COLLISION_MESSAGE = "A playbook with that name already exists";

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
  const [body, setBody] = useState(playbook?.body ?? "");
  const [nameFocus, setNameFocus] = useState(false);
  const [bodyFocus, setBodyFocus] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [footgunError, setFootgunError] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [saving, setSaving] = useState(false);

  const [generateOpen, setGenerateOpen] = useState(false);
  const [direction, setDirection] = useState("");
  const [sourcePaths, setSourcePaths] = useState<string[]>([]);
  const [browsingSource, setBrowsingSource] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generateFailed, setGenerateFailed] = useState(false);
  const [draftNotice, setDraftNotice] = useState(false);

  const trimmedName = name.trim();
  const hasFootgun = body.includes("DISPATCH_STATUS:");
  const canSave = trimmedName !== "" && !saving && !hasFootgun;

  function checkNameCollision() {
    const lower = trimmedName.toLowerCase();
    if (lower === "") return;
    const collides = existingNames.some((n) => n.toLowerCase() === lower);
    setNameError(collides ? COLLISION_MESSAGE : null);
  }

  function addSourcePath(path: string) {
    setSourcePaths((prev) => (prev.includes(path) ? prev : [...prev, path]));
    setBrowsingSource(false);
  }

  function removeSourcePath(path: string) {
    setSourcePaths((prev) => prev.filter((p) => p !== path));
  }

  async function handleGenerate() {
    if (generating || direction.trim() === "") return;
    setGenerating(true);
    setGenerateFailed(false);
    const result = await generatePlaybookDraft({
      direction: direction.trim(),
      sourcePaths,
    });
    setGenerating(false);
    if (!result.ok) {
      setGenerateFailed(true);
      return;
    }
    setBody(result.draft);
    setFootgunError(false);
    setGenerateOpen(false);
    setDirection("");
    setSourcePaths([]);
    setDraftNotice(true);
  }

  async function handleSave() {
    if (!canSave) return;
    if (mode === "edit" && playbook?.slug === undefined) return;
    setSaving(true);
    setSaveError(false);
    setFootgunError(false);
    try {
      const input = { name: trimmedName, body };
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
      onClose={onClose}
      controlRef={modalRef}
      initialFocusRef={nameInputRef}
      dialogStyle={{ maxHeight: "80vh" }}
    >
      <Modal.Header>
        {mode === "edit" ? (playbook?.name ?? "") : "New playbook"}
      </Modal.Header>
      <Modal.Body>
        <div
          className="scroll-stable-y"
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
              gap: "var(--space-sm)",
            }}
          >
            <Button
              variant="secondary"
              onClick={() => setGenerateOpen((o) => !o)}
              style={{ alignSelf: "flex-start" }}
            >
              <Sparkles size={14} strokeWidth={2} aria-hidden="true" />
              Generate with AI
            </Button>

            {generateOpen && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "var(--space-sm)",
                  padding: "var(--space-sm)",
                  background: "var(--surface-card)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius)",
                  transition:
                    "opacity 150ms ease-out, transform 150ms ease-out",
                }}
              >
                <textarea
                  value={direction}
                  disabled={generating}
                  onChange={(e) => setDirection(e.target.value)}
                  aria-label="Playbook generation direction"
                  placeholder="Describe what this playbook should do"
                  style={{
                    minHeight: "72px",
                    resize: "vertical",
                    padding: "var(--space-sm)",
                    background: "var(--surface-column)",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius)",
                    color: "var(--text)",
                    fontFamily: "var(--font-ui)",
                    fontSize: "var(--font-body)",
                    lineHeight: "var(--line-body)",
                    outline: "none",
                  }}
                />

                {sourcePaths.length > 0 && (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "var(--space-xs)",
                    }}
                  >
                    {sourcePaths.map((p) => (
                      <div
                        key={p}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "var(--space-xs)",
                          padding: "var(--space-sm)",
                          background: "var(--surface-column)",
                          borderRadius: "var(--radius)",
                        }}
                      >
                        <span
                          style={{
                            flex: "1 1 auto",
                            minWidth: 0,
                            fontFamily: "var(--font-mono)",
                            fontSize: "var(--font-label)",
                            lineHeight: "var(--line-label)",
                            color: "var(--text)",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {p}
                        </span>
                        <IconButton
                          aria-label={`Remove ${p}`}
                          disabled={generating}
                          onClick={() => removeSourcePath(p)}
                        >
                          <X size={12} strokeWidth={2} aria-hidden="true" />
                        </IconButton>
                      </div>
                    ))}
                  </div>
                )}

                <div>
                  <Button
                    variant="secondary"
                    disabled={generating}
                    onClick={() => setBrowsingSource(true)}
                  >
                    Add source folder
                  </Button>
                </div>

                {body.trim() !== "" && (
                  <span
                    style={{
                      fontSize: "var(--font-body)",
                      lineHeight: "var(--line-body)",
                      color: "var(--text-muted)",
                    }}
                  >
                    This replaces the current body text.
                  </span>
                )}

                <div>
                  <Button
                    variant="primary"
                    disabled={generating || direction.trim() === ""}
                    aria-busy={generating}
                    onClick={() => void handleGenerate()}
                  >
                    {generating ? "Generating…" : "Generate draft"}
                  </Button>
                </div>

                {generating && (
                  <span
                    style={{
                      fontSize: "var(--font-body)",
                      lineHeight: "var(--line-body)",
                      color: "var(--text-muted)",
                    }}
                  >
                    This can take a couple of minutes.
                  </span>
                )}

                {generateFailed && (
                  <Notice
                    tone="destructive"
                    label="Couldn't generate a draft — try again."
                  />
                )}
              </div>
            )}

            {browsingSource && (
              <FolderBrowserModal
                onClose={() => setBrowsingSource(false)}
                onSelect={addSourcePath}
              />
            )}
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
            {draftNotice && (
              <Notice tone="muted">
                Draft generated — review and edit before saving.
              </Notice>
            )}
            <textarea
              value={body}
              onChange={(e) => {
                setBody(e.target.value);
                setFootgunError(false);
                setDraftNotice(false);
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
      </Modal.Actions>
    </Modal>
  );
}
