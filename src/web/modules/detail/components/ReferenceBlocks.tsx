import { RotateCw } from "lucide-react";
import type { Card as CardModel } from "../../../../shared/types.js";
import { MemberRow } from "@/components/MemberRow";
import { Markdown } from "@/components/markdown/Markdown";
import { Button } from "@/components/ui/button";
import { PanelAlert, PanelMonoNotice, PanelMutedNotice } from "./PanelNotice";
import { PrList } from "./PrList";

interface ReferenceBlocksProps {
  card: CardModel | null;
  members?: CardModel[];
  membersActionable: boolean;
  onRetryCleanup: (id: string) => void;
}

export function ReferenceBlocks({
  card,
  members,
  membersActionable,
  onRetryCleanup,
}: ReferenceBlocksProps) {
  const c = card;
  return (
    <>
      {c != null && c.source === "group" && members != null && (
        <div className="flex flex-col gap-(--space-xs)">
          <span className="text-sm leading-(--line-label) font-medium text-muted-foreground">
            {`Members (${members.length})`}
          </span>
          {members.map((member) => (
            <MemberRow
              key={member.id}
              member={member}
              dense={false}
              actionable={membersActionable}
              groupPreviews={c.previews}
              groupPreviewsUnknown={c.previewsUnknown}
            />
          ))}
        </div>
      )}

      {c != null && <PrList card={c} />}

      {c != null && c.description != null && c.description.trim() !== "" ? (
        <div className="text-base leading-(--line-body) [word-break:break-word] text-foreground">
          <Markdown
            source={c.description}
            attachmentBase={`/api/cards/${encodeURIComponent(c.id)}/attachments`}
          />
        </div>
      ) : (
        <div className="text-base leading-(--line-body) text-muted-foreground italic">
          No description.
        </div>
      )}

      {c?.statusReason != null && c.statusReason.trim() !== "" && (
        <PanelMutedNotice label="Status">{c.statusReason}</PanelMutedNotice>
      )}

      {c?.startWarning != null && c.startWarning.trim() !== "" && (
        <PanelMutedNotice label="Start warning">
          {c.startWarning}
        </PanelMutedNotice>
      )}

      {c?.cleanupWarning != null && c.cleanupWarning.trim() !== "" && (
        <PanelMutedNotice
          label="Cleanup"
          action={
            <Button
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() => onRetryCleanup(c.id)}
            >
              <RotateCw className="size-3" aria-hidden="true" />
              Retry cleanup
            </Button>
          }
        >
          {c.cleanupWarning}
        </PanelMutedNotice>
      )}

      {c?.startError != null && (
        <div className="flex flex-col gap-(--space-lg) border-t border-border pt-(--space-lg)">
          <PanelAlert icon>
            {`Provisioning error: ${c.startError.step}`}
          </PanelAlert>
          <PanelMonoNotice>{c.startError.stderr}</PanelMonoNotice>
        </div>
      )}
    </>
  );
}
