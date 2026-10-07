import type { ReactNode } from "react";
import type { Item } from "../../../../shared/types.js";
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
import { Markdown } from "@/components/markdown/Markdown";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface MeetingDetailProps {
  item: Item;
  siblings: string[];
  transcript: ReactNode;
  busy: boolean;
  onBack?: () => void;
  onPromote: () => void;
  onRunAgent: () => void;
  onDone: () => void;
  onSnooze: (preset: SnoozePreset) => void;
}

export function MeetingDetail({
  item,
  siblings,
  transcript,
  busy,
  onBack,
  onPromote,
  onRunAgent,
  onDone,
  onSnooze,
}: MeetingDetailProps) {
  const feed = (
    <Badge tone="neutral">
      {item.meta.feed === "granola" ? "Granola" : "Pasted"}
    </Badge>
  );
  return (
    <DetailScroll testId="meeting-detail">
      <DetailHeader onBack={onBack} title={item.title}>
        <span className="min-w-0 text-base wrap-anywhere">
          {item.meta.meeting} on {item.meta.meetingDate}
        </span>
        {feed}
      </DetailHeader>
      {isWebUrl(item.url) ? (
        <ExternalTextLink href={item.url} className="self-start text-base">
          Open in Granola
        </ExternalTextLink>
      ) : null}
      <Markdown source={item.snippet} />
      <div>
        <h3 className="m-0 mt-2 mb-1 text-sm font-medium text-muted-foreground">
          Action items from this meeting
        </h3>
        <ul className="m-0 list-disc pl-4">
          <li className="mb-1 text-base wrap-anywhere text-foreground">
            <span className="flex min-w-0 items-center gap-2">
              <span className="min-w-0 font-semibold wrap-anywhere">
                {item.title}
              </span>
              <Badge tone="neutral">This item</Badge>
            </span>
          </li>
          {siblings.map((title, index) => (
            <li
              key={index}
              className="mb-1 text-base wrap-anywhere text-foreground"
            >
              {title}
            </li>
          ))}
        </ul>
      </div>
      {transcript}
      <DetailActions>
        <LoadingButton disabled={busy} onClick={onPromote}>
          Promote to ticket
        </LoadingButton>
        <LoadingButton variant="secondary" disabled={busy} onClick={onRunAgent}>
          Run agent
        </LoadingButton>
        <LoadingButton variant="secondary" disabled={busy} onClick={onDone}>
          Done
        </LoadingButton>
        <Select
          value=""
          disabled={busy}
          onValueChange={(preset) => onSnooze(preset as SnoozePreset)}
        >
          <SelectTrigger size="sm" aria-label="Snooze" className="flex-none">
            <SelectValue placeholder="Snooze" />
          </SelectTrigger>
          <SelectContent>
            {SNOOZE_PRESETS.map((preset) => (
              <SelectItem key={preset} value={preset}>
                {SNOOZE_LABELS[preset]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </DetailActions>
    </DetailScroll>
  );
}
