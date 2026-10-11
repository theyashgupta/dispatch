import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/boards/$key/settings")({
  pendingMs: 1000,
});
