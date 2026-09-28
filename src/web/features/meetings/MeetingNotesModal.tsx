import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type Ref,
} from "react";
import {
  createMeetingItems,
  draftMeetingItems,
  type MeetingDraft,
} from "../../lib/api.js";
import { Button } from "../../primitives/Button.js";
import { Collapsible } from "../../primitives/Collapsible.js";
import { Field } from "../../primitives/Field.js";
import { Markdown } from "../../primitives/Markdown.js";
import { Modal } from "../../primitives/Modal.js";
import { Notice } from "../../primitives/Notice.js";
import { Spinner } from "../../primitives/Spinner.js";
import { focusRing } from "../../primitives/focus-ring.js";

type Phase = "paste" | "generating" | "review";

interface ReviewRow {
  draft: MeetingDraft;
  checked: boolean;
  title: string;
}

const NOTES_MAX = 100_000;
const MEETING_MAX = 200;
const ME_MAX = 100;
const TITLE_MAX = 300;
const NAME_KEY = "dsp.meetingName";
const MARKER_ERROR = "content contains the DISPATCH_STATUS marker";

const columnStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-lg)",
  minWidth: 0,
};

const fieldStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-xs)",
  minWidth: 0,
};

const controlStyle: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  background: "var(--surface-card)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius)",
  color: "var(--text)",
  fontFamily: "var(--font-ui)",
  fontSize: "var(--font-body)",
  lineHeight: "var(--line-body)",
  outline: "none",
};

const inputStyle: CSSProperties = {
  ...controlStyle,
  height: "32px",
  padding: "0 var(--space-sm)",
};

const textareaStyle: CSSProperties = {
  ...controlStyle,
  resize: "vertical",
  padding: "var(--space-sm)",
};

const disabledStyle: CSSProperties = {
  opacity: 0.5,
  cursor: "not-allowed",
};

const mutedStyle: CSSProperties = {
  fontSize: "var(--font-label)",
  lineHeight: "var(--line-label)",
  color: "var(--text-muted)",
};

const captionStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-sm)",
  fontSize: "var(--font-body)",
  lineHeight: "var(--line-body)",
  color: "var(--text-muted)",
};

const headingStyle: CSSProperties = {
  margin: 0,
  fontSize: "var(--font-body)",
  fontWeight: "var(--weight-medium)",
  lineHeight: "var(--line-body)",
  overflowWrap: "anywhere",
};

const listStyle: CSSProperties = {
  ...columnStyle,
  gap: "var(--space-sm)",
  margin: 0,
  padding: 0,
  listStyle: "none",
};

const rowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "20px minmax(0, 1fr)",
  gap: "var(--space-xs) var(--space-sm)",
  alignItems: "center",
  paddingBottom: "var(--space-sm)",
  borderBottom: "1px solid var(--border)",
};

const actionsStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  justifyContent: "flex-end",
  gap: "var(--space-sm)",
};

const errorStyle: CSSProperties = {
  fontSize: "var(--font-body)",
  lineHeight: "var(--line-body)",
  color: "var(--destructive-text)",
};

function readSavedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

function saveName(name: string): void {
  try {
    if (name === "") localStorage.removeItem(NAME_KEY);
    else localStorage.setItem(NAME_KEY, name);
  } catch {
    return;
  }
}

function draftErrorCopy(error: string | null): string {
  if (error === "generate-in-progress") {
    return "Another draft is still running or stopping. Try again in a few seconds.";
  }
  if (error?.startsWith("invalid-") === true) {
    return "Check the meeting name and notes, then try again.";
  }
  return "Couldn't draft action items. Try again.";
}

interface TextFieldProps {
  label: string;
  value: string;
  maxLength: number;
  disabled?: boolean;
  inputRef?: Ref<HTMLInputElement>;
  onChange: (value: string) => void;
}

function TextField({
  label,
  value,
  maxLength,
  disabled,
  inputRef,
  onChange,
}: TextFieldProps) {
  const [focused, setFocused] = useState(false);
  return (
    <label style={fieldStyle}>
      <Field>{label}</Field>
      <input
        ref={inputRef}
        value={value}
        maxLength={maxLength}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          ...inputStyle,
          ...(disabled === true ? disabledStyle : {}),
          ...focusRing(focused),
        }}
      />
    </label>
  );
}

interface ReviewItemProps {
  row: ReviewRow;
  disabled: boolean;
  onChange: (next: ReviewRow) => void;
}

function ReviewItem({ row, disabled, onChange }: ReviewItemProps) {
  const [checkFocused, setCheckFocused] = useState(false);
  const [titleFocused, setTitleFocused] = useState(false);
  return (
    <li style={rowStyle}>
      <input
        type="checkbox"
        checked={row.checked}
        disabled={disabled}
        aria-label={row.title === "" ? row.draft.title : row.title}
        onChange={(e) => onChange({ ...row, checked: e.target.checked })}
        onFocus={(e) =>
          setCheckFocused(e.currentTarget.matches(":focus-visible"))
        }
        onBlur={() => setCheckFocused(false)}
        style={{ margin: 0, ...focusRing(checkFocused) }}
      />
      <input
        value={row.title}
        maxLength={TITLE_MAX}
        disabled={disabled}
        aria-label="Title"
        onChange={(e) => onChange({ ...row, title: e.target.value })}
        onFocus={() => setTitleFocused(true)}
        onBlur={() => setTitleFocused(false)}
        style={{
          ...inputStyle,
          ...(disabled ? disabledStyle : {}),
          ...focusRing(titleFocused),
        }}
      />
      <div style={{ gridColumn: "2", minWidth: 0 }}>
        <Collapsible title="Details">
          <Markdown source={row.draft.description} />
        </Collapsible>
      </div>
    </li>
  );
}

interface MeetingNotesModalProps {
  onClose: () => void;
  onCreated: (result: {
    created: number;
    updated: number;
    notesSaved: boolean;
  }) => void;
}

export function MeetingNotesModal({
  onClose,
  onCreated,
}: MeetingNotesModalProps) {
  const meetingRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  const [phase, setPhase] = useState<Phase>("paste");
  const [meeting, setMeeting] = useState("");
  const [me, setMe] = useState(readSavedName);
  const [notes, setNotes] = useState("");
  const [notesFocused, setNotesFocused] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const trimmedMeeting = meeting.trim();
  const canDraft = trimmedMeeting !== "" && notes.trim() !== "";
  const checkedRows = rows.filter((row) => row.checked);
  const blankTitle = checkedRows.some((row) => row.title.trim() === "");
  const canCreate = !creating && checkedRows.length > 0 && !blankTitle;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  async function handleDraft() {
    const name = me.trim();
    saveName(name);
    const controller = new AbortController();
    abortRef.current = controller;
    setDraftError(null);
    setPhase("generating");
    try {
      const result = await draftMeetingItems(
        trimmedMeeting,
        notes,
        name,
        controller.signal,
      );
      if (result.ok) {
        setRows(
          result.drafts.map((draft) => ({
            draft,
            checked: true,
            title: draft.title,
          })),
        );
        setCreateError(null);
        setPhase("review");
        return;
      }
      setDraftError(draftErrorCopy(result.error));
      setPhase("paste");
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        setDraftError(draftErrorCopy(null));
      }
      setPhase("paste");
    }
  }

  function handleCancel() {
    abortRef.current?.abort();
  }

  function handleBack() {
    setRows([]);
    setCreateError(null);
    setPhase("paste");
  }

  async function handleCreate() {
    setCreating(true);
    setCreateError(null);
    const result = await createMeetingItems(
      trimmedMeeting,
      checkedRows.map((row) => ({ ...row.draft, title: row.title.trim() })),
      notes,
    );
    if (result.ok) {
      onCreated({
        created: result.created,
        updated: result.updated,
        notesSaved: result.notesSaved,
      });
      if (mountedRef.current) onClose();
      return;
    }
    if (!mountedRef.current) return;
    setCreateError(
      result.error === MARKER_ERROR
        ? "An item contains the reserved DISPATCH_STATUS marker. Edit its title."
        : "Couldn't create the items. Try again.",
    );
    setCreating(false);
  }

  function handleRowChange(index: number, next: ReviewRow) {
    setRows((current) => current.map((row, i) => (i === index ? next : row)));
  }

  return (
    <Modal
      ariaLabel="New tickets from meeting notes"
      onClose={onClose}
      initialFocusRef={meetingRef}
      dialogStyle={{ width: "720px", maxHeight: "85vh" }}
    >
      <Modal.Header>New tickets from meeting notes</Modal.Header>
      <Modal.Body>
        <div style={columnStyle}>
          {phase !== "review" && (
            <>
              <TextField
                label="Meeting name"
                value={meeting}
                maxLength={MEETING_MAX}
                disabled={phase === "generating"}
                inputRef={meetingRef}
                onChange={setMeeting}
              />
              <TextField
                label="Your name in these notes"
                value={me}
                maxLength={ME_MAX}
                disabled={phase === "generating"}
                onChange={setMe}
              />
              <label style={fieldStyle}>
                <Field>Notes or transcript</Field>
                <textarea
                  rows={12}
                  value={notes}
                  maxLength={NOTES_MAX}
                  disabled={phase === "generating"}
                  onChange={(e) => setNotes(e.target.value)}
                  onFocus={() => setNotesFocused(true)}
                  onBlur={() => setNotesFocused(false)}
                  style={{
                    ...textareaStyle,
                    ...(phase === "generating" ? disabledStyle : {}),
                    ...focusRing(notesFocused),
                  }}
                />
                <span style={mutedStyle}>
                  {notes.length} of {NOTES_MAX} characters
                </span>
              </label>
            </>
          )}

          {phase === "generating" && (
            <span style={captionStyle} role="status">
              <Spinner />
              Reading the notes. This can take up to two and a half minutes.
            </span>
          )}

          {phase === "paste" && draftError !== null && (
            <Notice tone="destructive" label={draftError} />
          )}

          {phase === "review" && rows.length === 0 && (
            <span style={captionStyle}>
              No action items for you in these notes.
            </span>
          )}

          {phase === "review" && rows.length > 0 && (
            <>
              <h3 style={headingStyle}>
                {rows.length === 1
                  ? `1 action item from ${trimmedMeeting}`
                  : `${rows.length} action items from ${trimmedMeeting}`}
              </h3>
              <ul style={listStyle}>
                {rows.map((row, index) => (
                  <ReviewItem
                    key={row.draft.key}
                    row={row}
                    disabled={creating}
                    onChange={(next) => handleRowChange(index, next)}
                  />
                ))}
              </ul>
              {blankTitle && (
                <span style={mutedStyle}>
                  Every checked item needs a title.
                </span>
              )}
              {createError !== null && (
                <div role="alert" style={errorStyle}>
                  {createError}
                </div>
              )}
            </>
          )}
        </div>
      </Modal.Body>
      <Modal.Actions>
        <div style={actionsStyle}>
          {phase === "paste" && (
            <Button
              variant="primary"
              disabled={!canDraft}
              onClick={() => void handleDraft()}
            >
              Draft action items
            </Button>
          )}
          {phase === "generating" && (
            <Button variant="secondary" onClick={handleCancel}>
              Cancel
            </Button>
          )}
          {phase === "review" && (
            <>
              <Button
                variant="secondary"
                disabled={creating}
                onClick={handleBack}
              >
                Back
              </Button>
              {rows.length > 0 && (
                <Button
                  variant="primary"
                  disabled={!canCreate}
                  loading={creating}
                  onClick={() => void handleCreate()}
                >
                  {checkedRows.length === 1
                    ? "Create 1 item"
                    : `Create ${checkedRows.length} items`}
                </Button>
              )}
            </>
          )}
        </div>
      </Modal.Actions>
    </Modal>
  );
}
