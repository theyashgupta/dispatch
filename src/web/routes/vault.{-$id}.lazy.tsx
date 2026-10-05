import { createLazyFileRoute } from "@tanstack/react-router";
import { VaultView } from "@/modules/vault";
import { useAppState } from "@/components/AppState";

export const Route = createLazyFileRoute("/vault/{-$id}")({
  component: VaultRoute,
});

function VaultRoute() {
  const props = useAppState().vault;
  return <VaultView {...props} />;
}
