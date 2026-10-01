import { createLazyFileRoute } from "@tanstack/react-router";
import { VaultPage } from "@/features/vault";
import { useAppState } from "@/components/AppState";

export const Route = createLazyFileRoute("/vault/{-$id}")({
  component: VaultRoute,
});

function VaultRoute() {
  const props = useAppState().vault;
  return <VaultPage {...props} />;
}
