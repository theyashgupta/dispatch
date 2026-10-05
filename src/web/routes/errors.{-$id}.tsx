import { createFileRoute } from "@tanstack/react-router";
import { sentryIssueQueryOptions } from "@/modules/errors";
import { isSentryIssueId, sentryIssueId } from "../../shared/feed-items.js";

export const Route = createFileRoute("/errors/{-$id}")({
  loader: ({ context: { queryClient }, params: { id } }) => {
    const issueId = id ? sentryIssueId(id) : null;
    if (issueId === null || !isSentryIssueId(issueId)) return;
    void queryClient.prefetchQuery(sentryIssueQueryOptions(issueId));
  },
});
