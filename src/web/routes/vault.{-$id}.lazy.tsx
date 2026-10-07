import { createLazyFileRoute } from "@tanstack/react-router";
import { VaultView } from "@/modules/vault";

export const Route = createLazyFileRoute("/vault/{-$id}")({
  component: VaultView,
});
