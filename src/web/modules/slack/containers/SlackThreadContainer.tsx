import { useState } from "react";
import { SlackThread } from "@/modules/slack/components/SlackThread";
import { useLoadSlackThread } from "@/modules/slack/queries/slack-queries";

interface SlackThreadContainerProps {
  itemId: string;
  replyCount?: string;
}

export function SlackThreadContainer({
  itemId,
  replyCount,
}: SlackThreadContainerProps) {
  const [requested, setRequested] = useState(false);
  const query = useLoadSlackThread(itemId, requested);
  const shown = requested || query.data !== undefined;
  const loading = shown && query.isFetching;
  const result = shown && !loading ? query.data : undefined;

  function handleLoad() {
    if (shown) void query.refetch();
    else setRequested(true);
  }

  return (
    <SlackThread
      replyCount={replyCount}
      loading={loading}
      thread={result?.ok ? result.thread : null}
      failure={result && !result.ok ? result : null}
      onLoad={handleLoad}
    />
  );
}
