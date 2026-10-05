import { useId, type ReactNode } from "react";
import { formatAge, nowMs } from "../../../../shared/format-age.js";
import {
  SNOOZE_LABELS,
  SNOOZE_PRESETS,
  type SnoozePreset,
} from "../../../../shared/snooze.js";
import { isWebUrl } from "../../../../shared/web-url.js";
import {
  DetailActions,
  DetailHeader,
  DetailScroll,
} from "@/components/DetailPaneBody";
import { ExternalTextLink } from "@/components/ExternalTextLink";
import { LoadingButton } from "@/components/LoadingButton";
import { Badge } from "@/components/ui/badge";
import {
  slackActions,
  type SlackActionId,
} from "@/modules/slack/domain/slack-actions";
import {
  slackAuthor,
  slackPills,
  slackPlace,
  type SlackRow,
} from "@/modules/slack/domain/slack-rows";

interface SlackDetailProps {
  row: SlackRow;
  thread: ReactNode;
  busy: boolean;
  snoozeOpen: boolean;
  onBack?: () => void;
  onAction: (id: SlackActionId) => void;
  onSnooze: (preset: SnoozePreset) => void;
}

export function SlackDetail({
  row,
  thread,
  busy,
  snoozeOpen,
  onBack,
  onAction,
  onSnooze,
}: SlackDetailProps) {
  const snoozeGroupId = useId();
  const { item } = row;
  const { meta } = item;

  return (
    <DetailScroll testId="slack-detail">
      <DetailHeader onBack={onBack} title={slackAuthor(item)}>
        <span className="wrap-anywhere">
          {slackPlace(meta.conversation, meta.channelName ?? "")}
        </span>
        <span title={item.createdAt}>{formatAge(item.createdAt, nowMs())}</span>
        {slackPills(item).map((pill) => (
          <Badge
            key={pill.label}
            tone={pill.tone}
            title={pill.label}
            className="max-w-60"
          >
            <span className="truncate">{pill.label}</span>
          </Badge>
        ))}
      </DetailHeader>
      <p className="m-0 text-base wrap-anywhere whitespace-pre-wrap text-foreground">
        {item.snippet}
      </p>
      {isWebUrl(item.url) && (
        <ExternalTextLink href={item.url} className="self-start text-base">
          Open in Slack
        </ExternalTextLink>
      )}
      {thread}
      <DetailActions>
        {slackActions(row).map((action) => (
          <LoadingButton
            key={action.id}
            variant={action.id === "draftReply" ? "default" : "secondary"}
            disabled={busy}
            aria-expanded={action.id === "snooze" ? snoozeOpen : undefined}
            aria-controls={action.id === "snooze" ? snoozeGroupId : undefined}
            onClick={() => onAction(action.id)}
          >
            {action.label}
          </LoadingButton>
        ))}
      </DetailActions>
      {snoozeOpen && (
        <div
          id={snoozeGroupId}
          className="flex flex-wrap gap-2"
          role="group"
          aria-label="Snooze for"
        >
          {SNOOZE_PRESETS.map((preset) => (
            <LoadingButton
              key={preset}
              variant="secondary"
              disabled={busy}
              onClick={() => onSnooze(preset)}
            >
              {SNOOZE_LABELS[preset]}
            </LoadingButton>
          ))}
        </div>
      )}
    </DetailScroll>
  );
}
