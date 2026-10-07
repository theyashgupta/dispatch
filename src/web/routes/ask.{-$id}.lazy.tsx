import { createLazyFileRoute } from "@tanstack/react-router";
import { AskView } from "@/modules/ask";

export const Route = createLazyFileRoute("/ask/{-$id}")({
  component: AskRoute,
});

function AskRoute() {
  const { id } = Route.useParams();
  return <AskView prefill={id} />;
}
