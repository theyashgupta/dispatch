import { useId, useState, type CSSProperties, type ReactNode } from "react";
import { ChevronDown, ExternalLink } from "lucide-react";
import type { SourceCardStatus } from "../../shared/types.js";
import { Chip } from "./Chip.js";
import { Field } from "./Field.js";
import { focusRing } from "./focus-ring.js";

interface ConnectionCardProps {
  badge: ReactNode;
  name: string;
  status: SourceCardStatus;
  credentialLabel: string;
  steps?: ReactNode[];
  scopes?: string[];
  tokenPageUrl?: string;
  children?: ReactNode;
  footer?: ReactNode;
  details?: ReactNode;
  defaultOpen?: boolean;
}

const cardStyle: CSSProperties = {
  flexShrink: 0,
  background: "var(--surface-card)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius)",
  minWidth: 0,
};

const headerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-sm)",
  width: "100%",
  padding: "var(--space-lg)",
  background: "transparent",
  border: "none",
  borderRadius: "var(--radius)",
  color: "var(--text)",
  fontFamily: "var(--font-ui)",
  textAlign: "left",
  cursor: "pointer",
};

const titleColumnStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "2px",
  flex: "1 1 auto",
  minWidth: 0,
};

const titleRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  flexWrap: "wrap",
  gap: "var(--space-xs) var(--space-sm)",
  minWidth: 0,
};

const nameStyle: CSSProperties = {
  fontSize: "var(--font-body)",
  fontWeight: "var(--weight-semibold)",
  lineHeight: "var(--line-body)",
};

const mutedLineStyle: CSSProperties = {
  fontSize: "var(--font-label)",
  lineHeight: "var(--line-label)",
  color: "var(--text-muted)",
  overflowWrap: "anywhere",
};

const wrappingChipStyle: CSSProperties = {
  height: "auto",
  minHeight: "18px",
  whiteSpace: "normal",
  maxWidth: "100%",
};

const bodyStyle: CSSProperties = {
  display: "grid",
  transition: "grid-template-rows var(--motion-panel-open) var(--easing-enter)",
};

const bodyInnerStyle: CSSProperties = {
  minHeight: 0,
  minWidth: 0,
};

const bodyContentStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-lg)",
  padding: "var(--space-lg)",
  borderTop: "1px solid var(--border)",
};

const stepsStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-sm)",
  margin: 0,
  padding: 0,
  listStyle: "none",
};

const stepStyle: CSSProperties = {
  position: "relative",
  display: "grid",
  gridTemplateColumns: "20px minmax(0, 1fr)",
  gap: "var(--space-sm)",
  alignItems: "start",
};

const stepNumberStyle: CSSProperties = {
  position: "relative",
  zIndex: 1,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: "20px",
  height: "20px",
  borderRadius: "50%",
  border: "1px solid color-mix(in srgb, var(--text-muted) 40%, transparent)",
  background: "var(--surface-card)",
  color: "var(--text-muted)",
  fontSize: "var(--font-micro)",
  fontWeight: "var(--weight-semibold)",
};

const connectorStyle: CSSProperties = {
  position: "absolute",
  left: "10px",
  top: "20px",
  bottom: "calc(-1 * var(--space-sm))",
  width: "1px",
  background: "color-mix(in srgb, var(--text-muted) 40%, transparent)",
};

const stepTextStyle: CSSProperties = {
  fontSize: "var(--font-body)",
  lineHeight: "var(--line-body)",
  color: "var(--text)",
  paddingTop: "1px",
};

const NEUTRAL_CHIP_LABEL: Record<"checking" | "disconnected" | "soon", string> =
  {
    checking: "Checking",
    disconnected: "Not connected",
    soon: "Coming soon",
  };

const guideStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-sm)",
};

const chevronStyle: CSSProperties = {
  flex: "0 0 auto",
  color: "var(--text-muted)",
  transition: "transform var(--motion-panel-open) var(--easing-enter)",
};

const scopesRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  flexWrap: "wrap",
  gap: "var(--space-xs)",
};

const linkStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "var(--space-xs)",
  alignSelf: "flex-start",
  maxWidth: "100%",
  color: "var(--text)",
  fontSize: "var(--font-label)",
  lineHeight: "var(--line-label)",
  textDecoration: "underline",
  textUnderlineOffset: "2px",
  overflowWrap: "anywhere",
  outline: "none",
};

interface StatusChipProps {
  status: SourceCardStatus;
}

function StatusChip({ status }: StatusChipProps) {
  if (status.kind === "connected") {
    return (
      <>
        <Chip tone="success">Connected</Chip>
        {status.account && <span style={mutedLineStyle}>{status.account}</span>}
      </>
    );
  }
  if (status.kind === "error") {
    return (
      <Chip tone="danger" style={wrappingChipStyle}>
        {status.message}
      </Chip>
    );
  }
  return <Chip tone="neutral">{NEUTRAL_CHIP_LABEL[status.kind]}</Chip>;
}

interface TokenLinkProps {
  url: string;
}

function TokenLink({ url }: TokenLinkProps) {
  const [focused, setFocused] = useState(false);
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onFocus={(event) =>
        setFocused(event.currentTarget.matches(":focus-visible"))
      }
      onBlur={() => setFocused(false)}
      style={{ ...linkStyle, ...focusRing(focused) }}
    >
      <ExternalLink size={12} strokeWidth={2} aria-hidden="true" />
      {url.replace(/^https:\/\//, "")}
    </a>
  );
}

export function ConnectionCard({
  badge,
  name,
  status,
  credentialLabel,
  steps = [],
  scopes = [],
  tokenPageUrl,
  children,
  footer,
  details,
  defaultOpen = false,
}: ConnectionCardProps) {
  const [toggled, setToggled] = useState<boolean | null>(null);
  const [focused, setFocused] = useState(false);
  const bodyId = useId();
  const soon = status.kind === "soon";
  const open = !soon && (toggled ?? defaultOpen);

  const heading = (
    <>
      {badge}
      <span style={titleColumnStyle}>
        <span style={titleRowStyle}>
          <span style={nameStyle}>{name}</span>
          <StatusChip status={status} />
        </span>
        <span style={mutedLineStyle}>{credentialLabel}</span>
      </span>
    </>
  );

  if (soon) {
    return (
      <div style={cardStyle}>
        <div style={{ ...headerStyle, cursor: "default" }}>{heading}</div>
      </div>
    );
  }

  return (
    <div style={cardStyle}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setToggled(!open)}
        onFocus={(event) =>
          setFocused(event.currentTarget.matches(":focus-visible"))
        }
        onBlur={() => setFocused(false)}
        style={{ ...headerStyle, ...focusRing(focused) }}
      >
        {heading}
        <ChevronDown
          size={16}
          strokeWidth={2}
          aria-hidden="true"
          style={{
            ...chevronStyle,
            transform: open ? "rotate(180deg)" : "none",
          }}
        />
      </button>
      <div
        id={bodyId}
        style={{ ...bodyStyle, gridTemplateRows: open ? "1fr" : "0fr" }}
      >
        <div
          inert={!open}
          style={{
            ...bodyInnerStyle,
            overflow: open ? "visible" : "hidden",
          }}
        >
          <div style={bodyContentStyle}>
            {steps.length > 0 && (
              <div style={guideStyle}>
                <Field>Setup guide</Field>
                <ol style={stepsStyle}>
                  {steps.map((step, index) => (
                    <li key={index} style={stepStyle}>
                      {index < steps.length - 1 && (
                        <span aria-hidden="true" style={connectorStyle} />
                      )}
                      <span aria-hidden="true" style={stepNumberStyle}>
                        {index + 1}
                      </span>
                      <span style={stepTextStyle}>{step}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
            {scopes.length > 0 && (
              <div style={scopesRowStyle}>
                <Field>Scopes</Field>
                {scopes.map((scope) => (
                  <Chip
                    key={scope}
                    tone="neutral"
                    style={{ fontFamily: "var(--font-mono)" }}
                  >
                    {scope}
                  </Chip>
                ))}
              </div>
            )}
            {tokenPageUrl && <TokenLink url={tokenPageUrl} />}
            {children}
            {footer && <span style={mutedLineStyle}>{footer}</span>}
          </div>
          {details && <div style={bodyContentStyle}>{details}</div>}
        </div>
      </div>
    </div>
  );
}
