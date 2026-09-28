import type { CSSProperties } from "react";
import { Inbox, Monitor } from "lucide-react";
import { NARROW_QUERY, useMediaQuery } from "../../hooks/useMediaQuery.js";
import {
  ALL_CONNECTIONS,
  LINEAR_CONNECTION,
} from "../../lib/connection-meta.js";
import { SourceIcon, sourceAccent } from "../badges/index.js";

const mapStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  padding: "var(--space-lg)",
  background: "var(--surface-card)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius)",
};

const sourceGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: "var(--space-sm)",
  flex: "0 1 auto",
};

const boxStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-sm)",
  minWidth: 0,
  padding: "var(--space-xs) var(--space-sm)",
  background: "var(--surface-column)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius)",
  fontFamily: "var(--font-ui)",
  fontSize: "var(--font-body)",
  lineHeight: "var(--line-body)",
  color: "var(--text)",
};

const connectorStyle: CSSProperties = {
  flex: "1 1 var(--space-xl)",
  minWidth: "var(--space-lg)",
  height: "1px",
  background: "var(--border)",
};

const narrowConnectorStyle: CSSProperties = {
  alignSelf: "center",
  width: "1px",
  height: "var(--space-lg)",
  background: "var(--border)",
};

const hubIconStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  flex: "0 0 auto",
  width: "32px",
  height: "32px",
  borderRadius: "var(--radius)",
  border: "1px solid var(--border)",
  color: "var(--text-muted)",
};

const subLabelStyle: CSSProperties = {
  display: "block",
  fontSize: "var(--font-label)",
  lineHeight: "var(--line-label)",
  color: "var(--text-muted)",
};

interface SetupMapProps {
  linearConnected: boolean;
}

export function SetupMap({ linearConnected }: SetupMapProps) {
  const narrow = useMediaQuery(NARROW_QUERY);
  const connector = narrow ? narrowConnectorStyle : connectorStyle;
  return (
    <div
      role="img"
      aria-label={
        linearConnected
          ? "Connection map: Linear connected"
          : "Connection map: no source connected yet"
      }
      style={
        narrow
          ? { ...mapStyle, flexDirection: "column", alignItems: "stretch" }
          : mapStyle
      }
    >
      <div style={sourceGridStyle}>
        {ALL_CONNECTIONS.map(({ source, name }) => {
          const lit = linearConnected && source === LINEAR_CONNECTION.source;
          return (
            <div
              key={source}
              data-source={source}
              data-lit={lit}
              style={{
                ...boxStyle,
                ...(lit
                  ? { borderColor: sourceAccent(source) }
                  : { color: "var(--text-muted)" }),
              }}
            >
              <span style={{ display: "inline-flex", opacity: lit ? 1 : 0.45 }}>
                <SourceIcon source={source} />
              </span>
              <span>{name}</span>
            </div>
          );
        })}
      </div>
      <div style={connector} />
      <div style={boxStyle}>
        <span style={hubIconStyle}>
          <Monitor size={16} strokeWidth={2} aria-hidden="true" />
        </span>
        <span>
          This Mac
          <span style={subLabelStyle}>Local store</span>
        </span>
      </div>
      <div style={connector} />
      <div style={boxStyle}>
        <span style={hubIconStyle}>
          <Inbox size={16} strokeWidth={2} aria-hidden="true" />
        </span>
        <span>Inbox</span>
      </div>
    </div>
  );
}
