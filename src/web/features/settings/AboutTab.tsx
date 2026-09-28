import { useState, type CSSProperties } from "react";
import { ExternalLink } from "lucide-react";
import { LICENSE_NAME, REPOSITORY_URL } from "../../lib/about-meta.js";
import { Field } from "../../primitives/Field.js";
import { focusRing } from "../../primitives/focus-ring.js";
import {
  settingsRowStyle,
  settingsTabStyle,
  settingsTextStyle,
} from "./settings-styles.js";
import type { UpdatesTab } from "./UpdatesTab.js";

const linkStyle: CSSProperties = {
  ...settingsTextStyle,
  display: "inline-flex",
  alignItems: "center",
  gap: "var(--space-xs)",
  alignSelf: "flex-start",
  maxWidth: "100%",
  textDecoration: "underline",
  textUnderlineOffset: "2px",
  outline: "none",
};

interface AboutTabSectionProps {
  updatesTab: UpdatesTab;
}

export function AboutTabSection({ updatesTab }: AboutTabSectionProps) {
  const { read } = updatesTab;
  const [focused, setFocused] = useState(false);

  return (
    <div className="scroll-stable-y" style={settingsTabStyle}>
      <div style={settingsRowStyle}>
        <Field>Version</Field>
        <span style={settingsTextStyle}>
          {read.kind === "ready"
            ? `Dispatch ${read.status.current}`
            : "Dispatch"}
        </span>
      </div>
      <div style={settingsRowStyle}>
        <Field>Repository</Field>
        <a
          href={REPOSITORY_URL}
          target="_blank"
          rel="noopener noreferrer"
          onFocus={(e) => setFocused(e.currentTarget.matches(":focus-visible"))}
          onBlur={() => setFocused(false)}
          style={{ ...linkStyle, ...focusRing(focused) }}
        >
          <ExternalLink size={12} strokeWidth={2} aria-hidden="true" />
          {REPOSITORY_URL.replace(/^https:\/\//, "")}
        </a>
      </div>
      <div style={settingsRowStyle}>
        <Field>License</Field>
        <span style={settingsTextStyle}>{LICENSE_NAME}</span>
      </div>
    </div>
  );
}
