import { useState, type CSSProperties } from "react";
import { ImageOff } from "lucide-react";

interface ImageWithFallbackProps {
  src: string;
  alt?: string;
}

const anchorStyle: CSSProperties = {
  display: "block",
  margin: "0 0 var(--space-sm)",
  width: "fit-content",
  maxWidth: "100%",
};

const imgStyle: CSSProperties = {
  display: "block",
  maxWidth: "100%",
  maxHeight: "360px",
  objectFit: "contain",
  borderRadius: "var(--radius)",
  border: "1px solid var(--border)",
  background: "var(--surface-card)",
  cursor: "pointer",
};

const placeholderStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "var(--space-xs)",
  padding: "var(--space-sm) var(--space-lg)",
  background: "var(--surface-card)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius)",
  width: "fit-content",
  maxWidth: "100%",
  margin: "0 0 var(--space-sm)",
};

const placeholderIconStyle: CSSProperties = {
  color: "var(--text-muted)",
  flex: "0 0 auto",
};

const placeholderLabelStyle: CSSProperties = {
  fontSize: "var(--font-label)",
  lineHeight: "var(--line-label)",
  color: "var(--text-muted)",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

export function ImageWithFallback({ src, alt }: ImageWithFallbackProps) {
  const [broken, setBroken] = useState(false);

  if (broken) {
    return (
      <span style={placeholderStyle}>
        <ImageOff
          size={14}
          strokeWidth={2}
          aria-hidden
          style={placeholderIconStyle}
        />
        <span style={placeholderLabelStyle}>
          {alt ? `Image unavailable — ${alt}` : "Image unavailable"}
        </span>
      </span>
    );
  }

  return (
    <a href={src} target="_blank" rel="noopener noreferrer" style={anchorStyle}>
      <img
        src={src}
        alt={alt ?? ""}
        loading="lazy"
        onError={() => setBroken(true)}
        style={imgStyle}
      />
    </a>
  );
}
