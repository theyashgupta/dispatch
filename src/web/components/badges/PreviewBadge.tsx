import { Globe } from "lucide-react";
import type { PreviewInfo } from "../../../shared/types.js";
import { isWebUrl } from "../../../shared/web-url.js";
import { Badge } from "@/components/ui/badge";
import { previewBadgeTitle } from "./preview-evidence.js";

export function PreviewBadge({ preview }: { preview: PreviewInfo }) {
  const title = previewBadgeTitle(preview);
  const ariaLabel = `Open preview, localhost:${preview.port}`;
  return (
    <Badge
      asChild
      tone="success"
      className="h-auto cursor-pointer border-0 text-sm hover:opacity-85"
    >
      <button
        type="button"
        title={title}
        aria-label={ariaLabel}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          if (isWebUrl(preview.url))
            window.open(preview.url, "_blank", "noopener,noreferrer");
        }}
      >
        <Globe size={12} strokeWidth={2} aria-hidden="true" />
        {`:${preview.port}`}
      </button>
    </Badge>
  );
}
