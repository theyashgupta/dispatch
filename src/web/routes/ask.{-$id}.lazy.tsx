import { createLazyFileRoute } from "@tanstack/react-router";
import { AskView } from "@/modules/ask";
import { useAppState } from "@/components/AppState";

export const Route = createLazyFileRoute("/ask/{-$id}")({
  component: AskRoute,
});

function AskRoute() {
  const props = useAppState().ask;
  const { id } = Route.useParams();
  return <AskView {...props} prefill={id} />;
}
