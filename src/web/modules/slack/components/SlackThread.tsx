import type { ReactNode } from "react";
import { formatAge, nowMs } from "../../../../shared/format-age.js";
import type { SlackThread as SlackThreadModel } from "../../../../shared/types.js";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { ErrorAlert } from "@/components/ErrorAlert";
import { LoadingButton } from "@/components/LoadingButton";
import { Badge } from "@/components/ui/badge";

export interface SlackThreadFailure {
  reason: "rejected" | "unreachable";
  providerError?: string;
}

interface SlackThreadProps {
  replyCount?: string;
  loading: boolean;
  thread: SlackThreadModel | null;
  failure: SlackThreadFailure | null;
  onLoad: () => void;
}

const NOTE = "text-sm text-muted-foreground";

export function SlackThread({
  replyCount,
  loading,
  thread,
  failure,
  onLoad,
}: SlackThreadProps) {
  const now = nowMs();
  const badge: ReactNode =
    Number(replyCount) > 0 ? <Badge tone="neutral">{replyCount}</Badge> : null;
  return (
    <CollapsibleSection title="Thread" badge={badge}>
      <div className="flex flex-col items-start gap-2 pt-1">
        <LoadingButton variant="secondary" loading={loading} onClick={onLoad}>
          Load thread
        </LoadingButton>
        {thread ? (
          <>
            <ul className="m-0 flex w-full list-none flex-col gap-2 p-0">
              {thread.messages.map((message, i) => (
                <li key={`${message.time}-${i}`}>
                  <div className="flex items-baseline gap-1 text-sm">
                    <span className="font-semibold">{message.author}</span>
                    <span className="text-muted-foreground">
                      {formatAge(message.time, now)}
                    </span>
                  </div>
                  <div className="text-sm break-words whitespace-pre-wrap text-foreground">
                    {message.text}
                  </div>
                </li>
              ))}
            </ul>
            {thread.truncated ? (
              <div className={NOTE}>Showing the first 40 messages.</div>
            ) : null}
          </>
        ) : null}
        {failure ? (
          <ErrorAlert>
            {failure.reason === "rejected" && failure.providerError
              ? `Slack refused: ${failure.providerError}.`
              : "Couldn't load the thread. Try again."}
          </ErrorAlert>
        ) : null}
      </div>
    </CollapsibleSection>
  );
}
