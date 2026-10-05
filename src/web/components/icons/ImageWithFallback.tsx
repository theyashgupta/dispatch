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
      <span className="mb-2 flex w-fit max-w-full items-center gap-1 rounded-md border border-border bg-card px-4 py-2">
        <ImageOff
          aria-hidden
          strokeWidth={2}
          className="size-3.5 shrink-0 text-muted-foreground"
        />
        <span className="overflow-hidden text-sm leading-snug text-ellipsis whitespace-nowrap text-muted-foreground">
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
      className="mb-2 block w-fit max-w-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
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
