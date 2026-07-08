import { type CSSProperties, type ReactNode } from "react";

interface FieldProps {
  children: ReactNode;
  mono?: boolean;
  style?: CSSProperties;
}

const labelStyle: CSSProperties = {
  fontSize: "var(--font-label)",
  fontWeight: "var(--weight-semibold)",
  lineHeight: "var(--line-label)",
  color: "var(--text-muted)",
};

const monoLabelStyle: CSSProperties = {
  ...labelStyle,
  fontFamily: "var(--font-mono)",
};

export function Field({ children, mono, style }: FieldProps) {
  return (
    <span style={{ ...(mono ? monoLabelStyle : labelStyle), ...style }}>
      {children}
    </span>
  );
}
