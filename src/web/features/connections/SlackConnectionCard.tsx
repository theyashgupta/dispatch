import { useState, type CSSProperties } from "react";
import { SourceIcon } from "../../components/badges/index.js";
import { useSourceConnection } from "../../hooks/useSourceConnection.js";
import {
  SLACK_CONNECTION,
  SLACK_CONSENT,
  SLACK_THREAD_LIMIT_NOTE,
} from "../../lib/connection-meta.js";
import {
  SLACK_BOT_NOTE,
  SLACK_ERROR_COPY,
  slackSaidLine,
} from "../../lib/connection-status.js";
import { ConnectionCard } from "../../primitives/ConnectionCard.js";
import { CredentialForm } from "../../primitives/CredentialForm.js";
import { focusRing } from "../../primitives/focus-ring.js";
import { SlackChannelPicker } from "./SlackChannelPicker.js";

const bodyStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-lg)",
  minWidth: 0,
};

const switchLabelStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-sm)",
  fontFamily: "var(--font-ui)",
  fontSize: "var(--font-body)",
  lineHeight: "var(--line-body)",
  color: "var(--text)",
  cursor: "pointer",
};

const consentStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
  gap: "var(--space-lg)",
  minWidth: 0,
};

const consentHeadingStyle: CSSProperties = {
  margin: 0,
  fontFamily: "var(--font-ui)",
  fontSize: "var(--font-label)",
  lineHeight: "var(--line-label)",
  fontWeight: "var(--weight-semibold)",
  color: "var(--text)",
};

const consentListStyle: CSSProperties = {
  margin: "var(--space-xs) 0 0",
  paddingLeft: "var(--space-lg)",
  fontFamily: "var(--font-ui)",
  fontSize: "var(--font-body)",
  lineHeight: "var(--line-body)",
  color: "var(--text-muted)",
};

const noteStyle: CSSProperties = {
  margin: 0,
  fontFamily: "var(--font-ui)",
  fontSize: "var(--font-label)",
  lineHeight: "var(--line-label)",
  color: "var(--text-muted)",
  overflowWrap: "anywhere",
};

export function SlackConnectionCard() {
  const slack = useSourceConnection("slack", SLACK_ERROR_COPY);
  const [switchFocus, setSwitchFocus] = useState(false);
  const configured = slack.connection?.configured ?? false;
  const enabled = slack.connection?.enabled ?? false;
  const saidLine = slackSaidLine(
    slack.formError ? slack.formProviderError : slack.connection?.providerError,
  );
  return (
    <ConnectionCard
      badge={<SourceIcon source={SLACK_CONNECTION.source} />}
      name={SLACK_CONNECTION.name}
      status={slack.status}
      credentialLabel={SLACK_CONNECTION.credentialLabel}
      steps={SLACK_CONNECTION.steps}
      scopes={SLACK_CONNECTION.scopes}
      tokenPageUrl={SLACK_CONNECTION.tokenPageUrl}
      footer={SLACK_CONNECTION.footer}
      details={
        configured ? (
          <SlackChannelPicker
            key={slack.connection?.account ?? ""}
            enabled={enabled}
          />
        ) : undefined
      }
      defaultOpen={slack.startedConnected === false}
    >
      <div style={bodyStyle}>
        <label style={switchLabelStyle}>
          <input
            type="checkbox"
            role="switch"
            aria-checked={enabled}
            checked={enabled}
            disabled={!configured || slack.busy !== null}
            onChange={() =>
              void (enabled ? slack.disable() : slack.connectExisting())
            }
            onFocus={(e) =>
              setSwitchFocus(e.currentTarget.matches(":focus-visible"))
            }
            onBlur={() => setSwitchFocus(false)}
            style={{
              accentColor: "var(--accent)",
              flex: "0 0 auto",
              ...focusRing(switchFocus),
            }}
          />
          Poll Slack
        </label>
        <div style={consentStyle}>
          {SLACK_CONSENT.map((group) => (
            <div key={group.heading}>
              <h4 style={consentHeadingStyle}>{group.heading}</h4>
              <ul style={consentListStyle}>
                {group.lines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p style={noteStyle}>{SLACK_THREAD_LIMIT_NOTE}</p>
        <CredentialForm
          label={SLACK_CONNECTION.credentialLabel}
          configured={configured}
          busy={slack.busy}
          error={slack.formError ? SLACK_ERROR_COPY[slack.formError] : null}
          onConnect={slack.connect}
          onTest={() => void slack.test()}
          onDisconnect={() => void slack.disconnect()}
        />
        {saidLine && <p style={noteStyle}>{saidLine}</p>}
        {slack.connection?.tokenKind === "bot" && (
          <p style={noteStyle}>{SLACK_BOT_NOTE}</p>
        )}
      </div>
    </ConnectionCard>
  );
}
