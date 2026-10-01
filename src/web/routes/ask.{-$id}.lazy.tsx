import { createLazyFileRoute } from "@tanstack/react-router";
import { AskPage } from "@/features/ask";
import { useAppState } from "@/components/AppState";

export const Route = createLazyFileRoute("/ask/{-$id}")({
  component: AskRoute,
});

function AskRoute() {
  const props = useAppState().ask;
  const { id } = Route.useParams();
  return <AskPage {...props} prefill={id} />;
}
