import { useState, type CSSProperties } from "react";
import { useSlackChannels } from "../../hooks/useSlackChannels.js";
import {
  filterChannelRows,
  samePicked,
  SLACK_PICK_MAX,
  SLACK_SETUP_COPY,
} from "../../lib/slack-channels.js";
import { Button } from "../../primitives/Button.js";
import { Chip } from "../../primitives/Chip.js";
import { Field } from "../../primitives/Field.js";
import { focusRing } from "../../primitives/focus-ring.js";

interface SlackChannelPickerProps {
  enabled: boolean;
}

const FILTER_FROM = 20;

const wrapStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-sm)",
  minWidth: 0,
};

const listStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-xs)",
  maxHeight: "280px",
  overflowY: "auto",
  margin: 0,
  padding: 0,
  listStyle: "none",
  minWidth: 0,
};

const rowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-sm)",
  fontFamily: "var(--font-ui)",
  fontSize: "var(--font-body)",
  lineHeight: "var(--line-body)",
  color: "var(--text)",
  cursor: "pointer",
  minWidth: 0,
};

const nameStyle: CSSProperties = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  minWidth: 0,
};

const mutedStyle: CSSProperties = {
  margin: 0,
  fontFamily: "var(--font-ui)",
  fontSize: "var(--font-label)",
  lineHeight: "var(--line-label)",
  color: "var(--text-muted)",
  overflowWrap: "anywhere",
};

const inputStyle: CSSProperties = {
  flex: "1 1 200px",
  minWidth: 0,
  height: "32px",
  padding: "0 var(--space-sm)",
  background: "var(--surface-column)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius)",
  color: "var(--text)",
  fontFamily: "var(--font-ui)",
  fontSize: "var(--font-body)",
  lineHeight: "var(--line-body)",
};

const addRowStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "var(--space-sm)",
  minWidth: 0,
};

export function SlackChannelPicker({ enabled }: SlackChannelPickerProps) {
  const {
    saved,
    picked,
    rows,
    truncated,
    listFailure,
    loadFailed,
    addError,
    saveFailed,
    busy,
    toggle: handleToggle,
    add,
    clearAddError,
    save: handleSave,
  } = useSlackChannels(enabled);
  const [filter, setFilter] = useState("");
  const [paste, setPaste] = useState("");
  const [focus, setFocus] = useState<string | null>(null);

  const pickedIds = new Set(picked.map((c) => c.id));
  const visible = filterChannelRows(rows, filter);

  const handleAdd = async () => {
    if (await add(paste)) setPaste("");
  };

  if (!enabled) {
    return (
      <div style={wrapStyle}>
        <Field section>Channels to watch</Field>
        <p style={mutedStyle}>Turn on Poll Slack to pick channels.</p>
        {saved.length > 0 && (
          <p style={mutedStyle}>{saved.map((c) => `#${c.name}`).join(", ")}</p>
        )}
      </div>
    );
  }

  return (
    <div style={wrapStyle}>
      <Field section>Channels to watch</Field>
      {listFailure && <p style={mutedStyle}>{SLACK_SETUP_COPY[listFailure]}</p>}
      {rows.length > FILTER_FROM && (
        <input
          aria-label="Filter channels"
          placeholder="Filter channels"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          onFocus={() => setFocus("filter")}
          onBlur={() => setFocus(null)}
          style={{
            ...inputStyle,
            flex: "0 0 auto",
            ...focusRing(focus === "filter"),
          }}
        />
      )}
      <ul style={listStyle}>
        {visible.map((row) => (
          <li key={row.id}>
            <label style={rowStyle}>
              <input
                type="checkbox"
                checked={pickedIds.has(row.id)}
                disabled={busy}
                onChange={() => handleToggle(row)}
                onFocus={(e) =>
                  setFocus(
                    e.currentTarget.matches(":focus-visible") ? row.id : null,
                  )
                }
                onBlur={() => setFocus(null)}
                style={{
                  accentColor: "var(--accent)",
                  flex: "0 0 auto",
                  ...focusRing(focus === row.id),
                }}
              />
              <span style={nameStyle}>
                #{row.name}
                {row.notListed && !listFailure ? " (not listed)" : ""}
              </span>
              {row.private && <Chip>private</Chip>}
            </label>
          </li>
        ))}
      </ul>
      {truncated && (
        <p style={mutedStyle}>Only the first 1000 channels are listed.</p>
      )}
      <div style={addRowStyle}>
        <input
          aria-label="Channel link or ID"
          placeholder="Channel link or ID"
          value={paste}
          onChange={(e) => {
            setPaste(e.target.value);
            clearAddError();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !busy && paste.trim() !== "") {
              void handleAdd();
            }
          }}
          onFocus={() => setFocus("paste")}
          onBlur={() => setFocus(null)}
          style={{ ...inputStyle, ...focusRing(focus === "paste") }}
        />
        <Button
          variant="secondary"
          disabled={busy || paste.trim() === ""}
          onClick={() => void handleAdd()}
        >
          Add
        </Button>
      </div>
      {addError && <p style={mutedStyle}>{SLACK_SETUP_COPY[addError]}</p>}
      {loadFailed && (
        <p style={mutedStyle}>
          Couldn't load the saved channels. Reload Settings to try again.
        </p>
      )}
      {picked.length > SLACK_PICK_MAX && (
        <p style={mutedStyle}>Pick at most 200 channels.</p>
      )}
      {saveFailed && (
        <p style={mutedStyle}>Couldn't save the channels. Try again.</p>
      )}
      <div>
        <Button
          variant="primary"
          loading={busy}
          disabled={
            busy ||
            loadFailed ||
            picked.length > SLACK_PICK_MAX ||
            samePicked(picked, saved)
          }
          onClick={() => void handleSave()}
        >
          Save channels
        </Button>
      </div>
    </div>
  );
}
