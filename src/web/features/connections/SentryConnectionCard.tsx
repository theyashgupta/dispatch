import { useState } from "react";
import { SourceIcon } from "../../components/badges/index.js";
import { useSourceConnection } from "../../hooks/useSourceConnection.js";
import { SENTRY_CONNECTION } from "../../lib/connection-meta.js";
import {
  existingCredentialLabel,
  SENTRY_ERROR_COPY,
} from "../../lib/connection-status.js";
import { ConnectionCard } from "../../primitives/ConnectionCard.js";
import { CredentialForm } from "../../primitives/CredentialForm.js";
import { focusRing } from "../../primitives/focus-ring.js";

const helperTextStyle = {
  fontFamily: "var(--font-ui)",
  fontSize: "var(--font-label)",
  lineHeight: "var(--line-label)",
  color: "var(--text-muted)",
} as const;

const checkboxLabelTextStyle = {
  fontFamily: "var(--font-ui)",
  fontSize: "var(--font-body)",
  lineHeight: "var(--line-body)",
  color: "var(--text)",
} as const;

const checkboxRowStyle = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-xs)",
} as const;

const checkboxLabelStyle = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-sm)",
  cursor: "pointer",
} as const;

interface SentryConnectionCardProps {
  errorsInFeeds: boolean;
  onToggleErrorsInFeeds: (on: boolean) => void;
}

export function SentryConnectionCard({
  errorsInFeeds,
  onToggleErrorsInFeeds,
}: SentryConnectionCardProps) {
  const sentry = useSourceConnection("sentry", SENTRY_ERROR_COPY);
  const existing = existingCredentialLabel(sentry.connection);
  const [checkboxFocus, setCheckboxFocus] = useState(false);
  return (
    <ConnectionCard
      badge={<SourceIcon source={SENTRY_CONNECTION.source} />}
      name={SENTRY_CONNECTION.name}
      status={sentry.status}
      credentialLabel={SENTRY_CONNECTION.credentialLabel}
      steps={SENTRY_CONNECTION.steps}
      scopes={SENTRY_CONNECTION.scopes}
      tokenPageUrl={SENTRY_CONNECTION.tokenPageUrl}
      footer={SENTRY_CONNECTION.footer}
      defaultOpen={sentry.startedConnected === false}
      details={
        <div style={checkboxRowStyle}>
          <label style={checkboxLabelStyle}>
            <input
              type="checkbox"
              checked={errorsInFeeds}
              onChange={() => onToggleErrorsInFeeds(!errorsInFeeds)}
              onFocus={(e) =>
                setCheckboxFocus(e.currentTarget.matches(":focus-visible"))
              }
              onBlur={() => setCheckboxFocus(false)}
              style={{
                accentColor: "var(--accent)",
                borderRadius: "var(--radius)",
                ...focusRing(checkboxFocus),
                flex: "0 0 auto",
              }}
            />
            <span style={checkboxLabelTextStyle}>
              Show errors in Today and Inbox
            </span>
          </label>
          <span style={helperTextStyle}>
            Errors always show on the Errors page.
          </span>
        </div>
      }
    >
      <CredentialForm
        label={SENTRY_CONNECTION.credentialLabel}
        configured={sentry.connection?.enabled ?? false}
        busy={sentry.busy}
        error={sentry.formError ? SENTRY_ERROR_COPY[sentry.formError] : null}
        onConnect={sentry.connect}
        onTest={() => void sentry.test()}
        onDisconnect={() => void sentry.disconnect()}
        useExistingLabel={existing}
        onUseExisting={
          existing ? () => void sentry.connectExisting() : undefined
        }
      />
    </ConnectionCard>
  );
}
