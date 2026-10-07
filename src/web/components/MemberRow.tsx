import { ExternalLink } from "lucide-react";
import { isWebUrl } from "../../shared/web-url.js";
import type { Card, PreviewInfo, ProbeUnknown } from "../../shared/types.js";
import { PreviewBadge } from "@/components/badges/PreviewBadge";
import { SourceBadge } from "@/components/badges/SourceBadge";
import { UnknownProbeBadge } from "@/components/badges/UnknownProbeBadge";
import { Button } from "@/components/ui/button";
import { Item } from "@/components/ui/item";
import { cn } from "@/lib/utils";

interface MemberRowProps {
  member: Card;
  dense?: boolean;
  actionable: boolean;
  groupPreviews?: PreviewInfo[];
  groupPreviewsUnknown?: ProbeUnknown;
}

export function MemberRow({
  member,
  dense = true,
  actionable,
  groupPreviews,
  groupPreviewsUnknown,
}: MemberRowProps) {
  return (
    <Item size="sm" className="gap-1 rounded-none border-0 px-0 py-1">
      <span className="shrink-0 font-mono text-xs leading-(--line-label) font-semibold text-muted-foreground">
        {member.identifier}
      </span>
      <span
        className={cn(
          "min-w-0 flex-auto truncate font-normal text-foreground",
          dense ? "text-sm leading-(--line-label)" : "text-base",
        )}
      >
        {member.title}
      </span>
      {groupPreviews?.map((preview) => (
        <PreviewBadge key={preview.port} preview={preview} />
      ))}
      {groupPreviewsUnknown != null && (
        <UnknownProbeBadge
          signal="preview"
          category={groupPreviewsUnknown.category}
          partial={(groupPreviews?.length ?? 0) > 0}
        />
      )}
      <SourceBadge source={member.source ?? "linear"} />
      {actionable && member.source === "linear" && isWebUrl(member.url) && (
        <Button
          variant="ghost"
          size="icon-md"
          className="text-muted-foreground hover:text-muted-foreground"
          aria-label={`Open ${member.identifier} in Linear`}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            window.open(member.url, "_blank", "noopener,noreferrer");
          }}
        >
          <ExternalLink className="size-3" aria-hidden="true" />
        </Button>
      )}
    </Item>
  );
}
