import { createFileRoute } from "@tanstack/react-router";
import { pullRequestQueryOptions } from "@/modules/pull-requests";
import { parsePrKey } from "../../shared/pr-rows.js";

export const Route = createFileRoute("/pull-requests/{-$id}")({
  loader: ({ context: { queryClient }, params: { id } }) => {
    const ref = id ? parsePrKey(id) : null;
    if (!ref) return;
    void queryClient.prefetchQuery(
      pullRequestQueryOptions(ref.owner, ref.name, ref.number),
    );
  },
});
