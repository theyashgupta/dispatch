import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/boards/$key/sessions/{-$id}")({
  pendingMs: 1000,
});
