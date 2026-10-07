import { createLazyFileRoute } from "@tanstack/react-router";
import { PlaybooksView } from "@/modules/playbooks";

export const Route = createLazyFileRoute("/playbooks/{-$id}")({
  component: PlaybooksView,
});
