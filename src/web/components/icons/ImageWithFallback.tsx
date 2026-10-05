import { useState } from "react";
import { ImageOff } from "lucide-react";

interface ImageWithFallbackProps {
  src: string;
  alt?: string;
}

export function ImageWithFallback({ src, alt }: ImageWithFallbackProps) {
  const [broken, setBroken] = useState(false);

  if (broken) {
    return (
      <span className="m-0 mb-(--space-sm)! flex w-fit max-w-full items-center gap-(--space-xs) rounded-md border border-border bg-card px-(--space-lg) py-(--space-sm)">
        <ImageOff
          size={14}
          strokeWidth={2}
          aria-hidden
          className="flex-none text-muted-foreground"
        />
        <span className="overflow-hidden text-(length:--font-label) leading-(--line-label) text-ellipsis whitespace-nowrap text-muted-foreground">
          {alt ? `Image unavailable: ${alt}` : "Image unavailable"}
        </span>
      </span>
    );
  }

  return (
    <a
      href={src}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={alt != null && alt !== "" ? alt : "Open full image"}
      className="m-0 mb-(--space-sm)! block w-fit max-w-full"
    >
      <img
        src={src}
        alt={alt ?? ""}
        loading="lazy"
        onError={() => setBroken(true)}
        className="block max-h-90 min-h-12 max-w-full cursor-pointer rounded-md border border-border bg-card object-contain"
      />
    </a>
  );
}
