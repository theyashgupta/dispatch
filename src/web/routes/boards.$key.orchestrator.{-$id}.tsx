import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/boards/$key/orchestrator/{-$id}")({
  pendingMs: 1000,
});
