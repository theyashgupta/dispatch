import type { PrDetail } from "../../../../shared/types.js";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { Badge } from "@/components/ui/badge";
import {
  patchLineKind,
  type PatchLineKind,
} from "@/modules/pull-requests/domain/pr-detail-state";

interface PrFilesProps {
  detail: PrDetail;
}

const LINE_CLASS: Record<PatchLineKind, string> = {
  add: "text-(--status-ok)",
  remove: "text-destructive-text",
  hunk: "text-muted-foreground",
  context: "text-foreground",
};

export function PrFiles({ detail }: PrFilesProps) {
  return (
    <CollapsibleSection
      title="Files"
      badge={<Badge tone="neutral">{detail.changedFiles}</Badge>}
      defaultOpen
    >
      {detail.files.map((file) => (
        <CollapsibleSection
          key={file.filename}
          title={file.filename}
          badge={
            <Badge tone="neutral">
              +{file.additions} -{file.deletions}
            </Badge>
          }
        >
          {file.patch === undefined ? (
            <div className="text-base text-muted-foreground">
              No text diff for this file.
            </div>
          ) : (
            <pre className="m-0 overflow-x-auto rounded-md bg-sidebar p-2 font-mono text-xs leading-snug">
              {file.patch.split("\n").map((line, index) => (
                <div key={index} className={LINE_CLASS[patchLineKind(line)]}>
                  {line || " "}
                </div>
              ))}
            </pre>
          )}
          {file.patchTruncated && (
            <div className="text-base text-muted-foreground">
              Patch truncated
            </div>
          )}
        </CollapsibleSection>
      ))}
      {detail.filesTruncated && (
        <div className="text-base text-muted-foreground">
          Showing the first {detail.files.length} files.
        </div>
      )}
    </CollapsibleSection>
  );
}
