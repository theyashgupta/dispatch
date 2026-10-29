import { ExternalLink, Globe } from "lucide-react";
import type { PreviewInfo } from "../../../../shared/types.js";
import { isWebUrl } from "../../../../shared/web-url.js";
import { previewEvidenceLine } from "@/components/badges/preview-evidence";
import { Button } from "@/components/ui/button";
import { Item } from "@/components/ui/item";

const MONO_LABEL_CLASS =
  "font-mono text-xs leading-(--line-label) font-semibold";

export function PreviewRow({ preview }: { preview: PreviewInfo }) {
  return (
    <Item
      size="sm"
      className="flex-nowrap gap-(--space-sm) rounded-none border-0 p-0"
    >
      <Globe
        className="size-3.5 flex-none text-(--status-ok)"
        aria-hidden="true"
      />
      <div className="flex min-w-0 flex-auto items-baseline gap-(--space-sm)">
        <span className="flex-none text-sm font-semibold text-foreground">
          {`localhost:${preview.port}`}
        </span>
        <span className="flex-none text-sm text-(--status-ok)">Dev server</span>
        {preview.evidence != null && (
          <>
            <span
              title={previewEvidenceLine(preview.evidence)}
              className={`min-w-0 truncate ${MONO_LABEL_CLASS} text-muted-foreground`}
            >
              {previewEvidenceLine(preview.evidence)}
            </span>
            {preview.evidence.cwdMismatch === true && (
              <span
                className={`flex-none ${MONO_LABEL_CLASS} text-(--status-stale)`}
              >
                cwd mismatch
              </span>
            )}
          </>
        )}
      </div>
      <Button
        variant="ghost"
        size="icon-md"
        className="text-muted-foreground hover:text-muted-foreground"
        aria-label={`Open localhost:${preview.port} in browser`}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          if (isWebUrl(preview.url))
            window.open(preview.url, "_blank", "noopener,noreferrer");
        }}
      >
        <ExternalLink className="size-3.5" aria-hidden="true" />
      </Button>
    </Item>
  );
}
