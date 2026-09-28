import { useState, type CSSProperties } from "react";
import type { CalendarMode } from "../../../shared/types.js";
import { SourceIcon } from "../badges/index.js";
import { useCalendarConnection } from "../../hooks/useCalendarConnection.js";
import { CALENDAR_CONNECTION } from "../../lib/connection-meta.js";
import { calendarCardStatus } from "../../lib/connection-status.js";
import { routeHash } from "../../lib/route.js";
import { Button } from "../../primitives/Button.js";
import { Chip } from "../../primitives/Chip.js";
import { ConnectionCard } from "../../primitives/ConnectionCard.js";
import { Field } from "../../primitives/Field.js";
import { Select } from "../../primitives/Select.js";
import { focusRing } from "../../primitives/focus-ring.js";
import { controlsStyle, rowStyle } from "./card-styles.js";

const MODE_LABELS: Record<CalendarMode, string> = {
  macos: "This Mac's Calendar",
  ical: "iCal URL",
};

const listStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-xs)",
  margin: 0,
  padding: 0,
  border: "none",
  minWidth: 0,
};

const checkLabelStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "var(--space-xs)",
  fontSize: "var(--font-body)",
  color: "var(--text)",
  cursor: "pointer",
  minWidth: 0,
  overflowWrap: "anywhere",
};

const checkInputStyle: CSSProperties = {
  margin: 0,
  flex: "0 0 auto",
  accentColor: "var(--accent)",
  cursor: "inherit",
};

const lineStyle: CSSProperties = {
  fontSize: "var(--font-label)",
  lineHeight: "var(--line-label)",
  color: "var(--text-muted)",
  overflowWrap: "anywhere",
};

const linkStyle: CSSProperties = {
  color: "var(--text)",
  fontSize: "var(--font-label)",
  textDecoration: "underline",
};

interface CalendarCheckProps {
  title: string;
  checked: boolean;
  onToggle: () => void;
}

function CalendarCheck({ title, checked, onToggle }: CalendarCheckProps) {
  const [focused, setFocused] = useState(false);
  return (
    <label style={checkLabelStyle}>
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        onFocus={(event) =>
          setFocused(event.currentTarget.matches(":focus-visible"))
        }
        onBlur={() => setFocused(false)}
        style={{ ...checkInputStyle, ...focusRing(focused) }}
      />
      {title}
    </label>
  );
}

function VaultLink() {
  const [focused, setFocused] = useState(false);
  return (
    <a
      href={routeHash({ page: "vault" })}
      onFocus={(event) =>
        setFocused(event.currentTarget.matches(":focus-visible"))
      }
      onBlur={() => setFocused(false)}
      style={{ ...linkStyle, ...focusRing(focused) }}
    >
      Open Vault
    </a>
  );
}

export function CalendarConnectionCard() {
  const calendar = useCalendarConnection();
  const status = calendar.status;
  const enabled = status?.enabled === true;
  return (
    <ConnectionCard
      badge={<SourceIcon source={CALENDAR_CONNECTION.source} />}
      name={CALENDAR_CONNECTION.name}
      status={calendarCardStatus(
        status,
        calendar.actionError,
        calendar.loadFailed,
      )}
      credentialLabel={CALENDAR_CONNECTION.credentialLabel}
      steps={CALENDAR_CONNECTION.steps}
      footer={CALENDAR_CONNECTION.footer}
    >
      <div style={controlsStyle}>
        <div style={rowStyle}>
          <Field>Read from</Field>
          <Select
            label="Read from"
            value={calendar.mode}
            labels={MODE_LABELS}
            disabled={calendar.busy}
            onChange={calendar.setMode}
          />
        </div>
        {calendar.mode === "macos" ? (
          <>
            <div style={rowStyle}>
              <Button
                onClick={() => void calendar.loadCalendars()}
                loading={calendar.loadingChoices}
                disabled={calendar.loadingChoices || calendar.busy}
              >
                Load calendars
              </Button>
            </div>
            {calendar.choices !== null && (
              <fieldset style={listStyle} aria-label="Calendars">
                {calendar.choices.map((choice) => (
                  <CalendarCheck
                    key={choice.title}
                    title={choice.title}
                    checked={calendar.selected.has(choice.title)}
                    onToggle={() => calendar.toggle(choice.title)}
                  />
                ))}
              </fieldset>
            )}
          </>
        ) : (
          <div style={rowStyle}>
            <span style={lineStyle}>
              Fill CALENDAR_ICAL_URL in Settings, Vault.
            </span>
            <Chip tone={status?.icalFilled === true ? "success" : "neutral"}>
              {status?.icalFilled === true ? "Filled" : "Empty"}
            </Chip>
            <VaultLink />
          </div>
        )}
        <div style={rowStyle}>
          {enabled ? (
            <>
              <Button
                variant="primary"
                onClick={() => void calendar.save()}
                loading={calendar.busy}
                disabled={calendar.busy}
              >
                Save
              </Button>
              <Button
                onClick={() => void calendar.disconnect()}
                disabled={calendar.busy}
              >
                Disconnect
              </Button>
            </>
          ) : (
            <Button
              variant="primary"
              onClick={() => void calendar.connect()}
              loading={calendar.busy}
              disabled={calendar.busy || status === null}
            >
              Connect
            </Button>
          )}
        </div>
      </div>
    </ConnectionCard>
  );
}
