import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/boards/$key/inbox/{-$id}")({
  pendingMs: 1000,
});
