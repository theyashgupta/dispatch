import type { CSSProperties } from "react";
import { MAPPED_COLUMNS } from "../../../shared/linear-state-map.js";
import { useLinearStateMap } from "../../hooks/useLinearStateMap.js";
import { COLUMN_LABELS } from "../../lib/event-copy.js";
import { Button } from "../../primitives/Button.js";
import { Field } from "../../primitives/Field.js";
import { Notice } from "../../primitives/Notice.js";
import { Select } from "../../primitives/Select.js";
import { WarningIcon } from "../../primitives/WarningIcon.js";

const sectionStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-lg)",
  paddingTop: "var(--space-lg)",
  paddingRight: "var(--space-lg)",
  paddingBottom: "var(--space-lg)",
  borderTop: "1px solid var(--border)",
  minWidth: 0,
};

const headingStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-xs)",
};

const titleStyle: CSSProperties = {
  color: "var(--text)",
  fontSize: "var(--font-body)",
};

const teamStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-sm)",
  minWidth: 0,
};

const gridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(min(160px, 100%), 1fr))",
  gap: "var(--space-sm)",
};

const fieldStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-xs)",
  minWidth: 0,
};

const helpStyle: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: "var(--font-body)",
  lineHeight: "var(--line-body)",
  color: "var(--text-muted)",
};

const columnLabelStyle: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: "var(--font-label)",
  lineHeight: "var(--line-label)",
  color: "var(--text-muted)",
};

export function LinearStateMapSection() {
  const {
    workflow,
    draft,
    loadError,
    saving,
    saveResult,
    handleChoose,
    handleSave,
  } = useLinearStateMap();

  return (
    <section style={sectionStyle} aria-label="Linear state map">
      <div style={headingStyle}>
        <Field style={titleStyle}>Linear states for board columns</Field>
        <span style={helpStyle}>
          A manual move or a session start sets the chosen Linear state.
        </span>
      </div>
      {workflow.status === "error" && (
        <Notice
          tone="destructive"
          icon={<WarningIcon />}
          label={workflow.error}
        />
      )}
      {loadError && (
        <Notice
          tone="destructive"
          icon={<WarningIcon />}
          label="Couldn't load the state map. Reopen settings to retry."
        />
      )}
      {workflow.status === "ready" &&
        draft &&
        workflow.workflow.teams.map((team) => (
          <div key={team.id} style={teamStyle}>
            <Field>
              {team.name} ({team.key})
            </Field>
            <div style={gridStyle}>
              {MAPPED_COLUMNS.map((column) => (
                <label key={column} style={fieldStyle}>
                  <span style={columnLabelStyle}>{COLUMN_LABELS[column]}</span>
                  <Select
                    label={`${team.name} ${COLUMN_LABELS[column]}`}
                    value={draft[team.id]?.[column] ?? ""}
                    onChange={(value) => handleChoose(team.id, column, value)}
                  >
                    {team.states.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                    <option value="">Do not sync</option>
                  </Select>
                </label>
              ))}
            </div>
          </div>
        ))}
      {workflow.status === "ready" && draft && (
        <div>
          <Button
            variant="secondary"
            onClick={() => void handleSave()}
            loading={saving}
          >
            {saving ? "Saving…" : "Save state map"}
          </Button>
        </div>
      )}
      {saveResult?.ok === true && (
        <span style={columnLabelStyle}>State map saved.</span>
      )}
      {saveResult?.ok === false && (
        <Notice tone="destructive" label={saveResult.error} />
      )}
    </section>
  );
}
