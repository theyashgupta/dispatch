import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/boards/$key/dashboard/{-$id}")({
  pendingMs: 1000,
});
