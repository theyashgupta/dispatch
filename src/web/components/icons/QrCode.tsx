import { useMemo } from "react";
import { renderSVG } from "uqr";

interface QrCodeProps {
  value: string;
}

export function QrCode({ value }: QrCodeProps) {
  const svg = useMemo(
    () => renderSVG(value).replace("<svg ", '<svg width="100%" height="100%" '),
    [value],
  );
  return (
    <span
      role="img"
      aria-label="QR code for the tunnel URL"
      className="box-border inline-flex size-40 rounded-md bg-(--qr-surface) p-2"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
