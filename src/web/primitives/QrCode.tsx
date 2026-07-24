import { useMemo, type CSSProperties } from "react";
import { renderSVG } from "uqr";

interface QrCodeProps {
  value: string;
  size?: number;
}

const chipStyle: CSSProperties = {
  display: "inline-flex",
  width: "fit-content",
  padding: "var(--space-sm)",
  background: "#ffffff",
  borderRadius: "var(--radius)",
};

export function QrCode({ value, size = 160 }: QrCodeProps) {
  const svg = useMemo(
    () => renderSVG(value).replace("<svg ", '<svg width="100%" height="100%" '),
    [value],
  );
  return (
    <span
      role="img"
      aria-label="QR code for the tunnel URL"
      style={{ ...chipStyle, width: size, height: size }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
